const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const admin = require("../controllers/adminController");
const auth = require("../middleware/authenticate");
const audit = require("../utils/audit");
const Inventory = require("../models/Inventory");
const {
	listToolUsage,
	summarizeToolUsage,
	createToolUsageEntry,
	updateToolUsageEntry,
	deleteToolUsageEntry,
} = require("../utils/toolUsageManagement");

// only authenticated secretaries should be able to hit these endpoints
router.use(auth.authenticate);
router.use(auth.requireRole("secretary"));

// for now we only need the analytics summary; reuse admin controller logic
router.get("/analytics/summary", admin.analyticsSummary);

// Inventory visibility/adjustment (secretary)
router.get("/inventory", async (req, res, next) => {
	try {
		const q = req.query || {};
		const filter = {};

		if (q.search) {
			const re = new RegExp(String(q.search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
			filter.$or = [{ itemName: re }, { barcode: re }, { supplier: re }];
		}
		if (q.active === "true") filter.active = true;
		if (q.active === "false") filter.active = false;
		if (q.stockOnly === "true") filter.isStockItem = true;
		if (q.category && mongoose.Types.ObjectId.isValid(q.category)) {
			filter.category = q.category;
		}

		const limit = Math.min(Math.max(1, Number(q.limit) || 200), 1000);
		const items = await Inventory.find(filter)
			.sort({ itemName: 1 })
			.limit(limit)
			.populate("category", "name")
			.lean();

		return res.json({ items, count: items.length });
	} catch (err) {
		next(err);
	}
});

router.patch("/inventory/:id/stock", async (req, res, next) => {
	try {
		const { id } = req.params;
		if (!mongoose.Types.ObjectId.isValid(id)) {
			return res.status(400).json({ error: "Invalid inventory id" });
		}

		const item = await Inventory.findById(id);
		if (!item) return res.status(404).json({ error: "Inventory item not found" });

		const patch = {};

		if (req.body.quantity !== undefined) {
			const quantity = Number(req.body.quantity);
			if (!Number.isFinite(quantity) || quantity < 0) {
				return res.status(400).json({ error: "Quantity must be a non-negative number" });
			}
			patch.quantity = quantity;
		}

		if (req.body.delta !== undefined) {
			const delta = Number(req.body.delta);
			if (!Number.isFinite(delta)) {
				return res.status(400).json({ error: "Delta must be a valid number" });
			}
			const nextQty = Number(item.quantity || 0) + delta;
			if (nextQty < 0) {
				return res.status(409).json({ error: "Stock cannot be negative" });
			}
			patch.quantity = nextQty;
		}

		if (req.body.minStockLevel !== undefined) {
			const minStockLevel = Number(req.body.minStockLevel);
			if (!Number.isFinite(minStockLevel) || minStockLevel < 0) {
				return res.status(400).json({ error: "minStockLevel must be a non-negative number" });
			}
			patch.minStockLevel = minStockLevel;
		}

		if (!Object.keys(patch).length) {
			return res.status(400).json({ error: "No valid stock fields provided" });
		}

		Object.assign(item, patch);
		await item.save();

		await audit.logEvent({
			actor: req.user && req.user._id,
			target: item._id,
			action: "inventory.secretary.update",
			module: "secretary",
			req,
			details: {
				quantity: item.quantity,
				minStockLevel: item.minStockLevel,
			},
		});

		return res.json({ message: "Inventory updated", item });
	} catch (err) {
		next(err);
	}
});

// Tool usage management (secretary)
router.get("/tool-usage", async (req, res, next) => {
	try {
		const result = await listToolUsage(req.query || {}, 200);
		return res.json(result);
	} catch (err) {
		next(err);
	}
});

router.get("/tool-usage/summary", async (req, res, next) => {
	try {
		const summary = await summarizeToolUsage(req.query || {});
		return res.json(summary);
	} catch (err) {
		next(err);
	}
});

router.get("/tool-usage/options", async (req, res, next) => {
	try {
		const BookingService = require("../models/BookingService");
		const Technician = require("../models/Technician");

		const [bookings, technicians, inventory] = await Promise.all([
			BookingService.find({ status: { $ne: "cancelled" } })
				.sort({ bookingDate: -1, startTime: -1 })
				.limit(300)
				.select("_id bookingReference bookingDate startTime customerName customerId technicianId")
				.lean(),
			Technician.find({})
				.sort({ createdAt: -1 })
				.limit(200)
				.select("_id name firstName lastName email")
				.lean(),
			Inventory.find({ active: true, isStockItem: true })
				.sort({ itemName: 1 })
				.limit(600)
				.select("_id itemName unit quantity costPrice")
				.lean(),
		]);

		return res.json({ bookings, technicians, inventory });
	} catch (err) {
		next(err);
	}
});

router.post("/tool-usage", async (req, res, next) => {
	try {
		const result = await createToolUsageEntry({
			body: req.body || {},
			actorId: req.user && req.user._id,
			req,
			moduleName: "secretary",
			allowFuelAndToolCostInput: false,
		});
		return res.status(201).json({
			message: "Tool usage recorded",
			usage: result.usage,
			inventory: result.inventory
				? {
						_id: result.inventory._id,
						itemName: result.inventory.itemName,
						unit: result.inventory.unit,
						quantity: result.inventory.quantity,
					}
				: null,
		});
	} catch (err) {
		if (err.status) return res.status(err.status).json({ error: err.message });
		next(err);
	}
});

router.patch("/tool-usage/:usageId", async (req, res, next) => {
	try {
		const usage = await updateToolUsageEntry({
			usageId: req.params.usageId,
			body: req.body || {},
			actorId: req.user && req.user._id,
			req,
			moduleName: "secretary",
			allowFuelAndToolCostPatch: false,
		});
		return res.json({ message: "Tool usage updated", usage });
	} catch (err) {
		if (err.status) return res.status(err.status).json({ error: err.message });
		next(err);
	}
});

router.delete("/tool-usage/:usageId", async (req, res, next) => {
	try {
		const result = await deleteToolUsageEntry({
			usageId: req.params.usageId,
			actorId: req.user && req.user._id,
			req,
			moduleName: "secretary",
		});
		return res.json({ message: "Tool usage deleted and stock restored", ...result });
	} catch (err) {
		if (err.status) return res.status(err.status).json({ error: err.message });
		next(err);
	}
});

module.exports = router;

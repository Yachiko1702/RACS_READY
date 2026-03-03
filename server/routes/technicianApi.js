/**
 * Technician-facing REST API
 * Mounted at /api/technician
 * All routes require: authenticated + role === "technician"
 */
const express   = require("express");
const mongoose  = require("mongoose");
const router    = express.Router();
const auth      = require("../middleware/authenticate");
const audit     = require("../utils/audit");

async function loadTechnicianContext(userId) {
  const Technician = require("../models/Technician");
  const tech = await Technician.findOne({ user: userId }).lean();
  if (!tech) return { tech: null, technicianIds: [] };
  const technicianIds = [String(tech._id)];
  if (tech.user) technicianIds.push(String(tech.user));
  if (userId) technicianIds.push(String(userId));
  return { tech, technicianIds: Array.from(new Set(technicianIds)) };
}

// ── Auth guards ───────────────────────────────────────────────────────────────
router.use(auth.authenticate);
router.use(auth.requireRole("technician"));

// ── Leave Requests ────────────────────────────────────────────────────────────

/**
 * GET /api/technician/leave-requests
 * Returns the authenticated technician's own leave requests, newest first.
 */
router.get("/leave-requests", async (req, res, next) => {
  try {
    const Technician   = require("../models/Technician");
    const LeaveRequest = require("../models/LeaveRequest");

    const tech = await Technician.findOne({ user: req.user._id }).lean();
    if (!tech) return res.status(404).json({ error: "Technician record not found" });

    const items = await LeaveRequest.find({ technicianId: tech._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.json({ items, count: items.length });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/technician/leave-requests
 * Body: { startDate: "YYYY-MM-DD", endDate?: "YYYY-MM-DD", reason?: string }
 * Creates a new pending leave request. Rejects overlapping pending requests.
 */
router.post("/leave-requests", async (req, res, next) => {
  try {
    const Technician   = require("../models/Technician");
    const LeaveRequest = require("../models/LeaveRequest");

    const tech = await Technician.findOne({ user: req.user._id }).lean();
    if (!tech) return res.status(404).json({ error: "Technician record not found" });

    const { startDate, endDate, reason } = req.body;
    if (!startDate) return res.status(400).json({ error: "Start date is required." });

    const start = new Date(startDate + "T00:00:00");
    const end   = endDate ? new Date(endDate + "T00:00:00") : new Date(start);

    if (isNaN(start.getTime())) return res.status(400).json({ error: "Invalid start date." });
    if (isNaN(end.getTime()))   return res.status(400).json({ error: "Invalid end date." });
    if (end < start)            return res.status(400).json({ error: "End date cannot be before start date." });

    // Block duplicate pending requests covering the same date range
    const conflict = await LeaveRequest.findOne({
      technicianId: tech._id,
      status:       "pending",
      startDate:    { $lte: end },
      endDate:      { $gte: start },
    }).lean();

    if (conflict) {
      return res.status(409).json({
        error: "You already have a pending leave request that overlaps with these dates.",
      });
    }

    const leave = new LeaveRequest({
      technicianId: tech._id,
      technician:   {
        name:  tech.name  || "",
        email: tech.email || "",
        phone: tech.phone || "",
      },
      startDate: start,
      endDate:   end,
      reason:    String(reason || "").trim().slice(0, 500),
    });
    await leave.save();

    await audit.logEvent({
      actor:   req.user._id,
      target:  tech._id,
      action:  "leave.request.create",
      module:  "technician",
      req,
      details: { startDate, endDate: endDate || startDate, reason },
    });

    return res.status(201).json({ message: "Leave request submitted successfully.", leave });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/technician/leave-requests/:id
 * Cancel own pending leave request only (cannot cancel approved/rejected).
 */
router.delete("/leave-requests/:id", async (req, res, next) => {
  try {
    const Technician   = require("../models/Technician");
    const LeaveRequest = require("../models/LeaveRequest");

    const tech = await Technician.findOne({ user: req.user._id }).lean();
    if (!tech) return res.status(404).json({ error: "Technician record not found" });

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });

    const leave = await LeaveRequest.findOne({ _id: id, technicianId: tech._id });
    if (!leave) return res.status(404).json({ error: "Leave request not found" });
    if (leave.status !== "pending") {
      return res.status(400).json({ error: "Only pending requests can be cancelled." });
    }

    await leave.deleteOne();

    await audit.logEvent({
      actor:   req.user._id,
      target:  tech._id,
      action:  "leave.request.cancel",
      module:  "technician",
      req,
      details: { leaveId: id },
    });

    return res.json({ message: "Leave request cancelled." });
  } catch (err) {
    next(err);
  }
});

// ── Tool Usage Tracking ──────────────────────────────────────────────────────

/**
 * GET /api/technician/tools/catalog
 * Lightweight inventory list for tool selection.
 */
router.get("/tools/catalog", async (req, res, next) => {
  try {
    const Inventory = require("../models/Inventory");
    const items = await Inventory.find({
      active: true,
    })
      .select("itemName quantity unit barcode isStockItem costPrice sellingPrice")
      .sort({ itemName: 1 })
      .limit(500)
      .lean();

    return res.json({ items, count: items.length });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/technician/appointments/:id/tools
 * List tool usage records for one appointment (technician-scoped).
 */
router.get("/appointments/:id/tools", async (req, res, next) => {
  try {
    const BookingService = require("../models/BookingService");
    const ServiceToolUsage = require("../models/ServiceToolUsage");
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid appointment id" });

    const { tech, technicianIds } = await loadTechnicianContext(req.user._id);
    if (!tech) return res.status(404).json({ error: "Technician record not found" });

    const appt = await BookingService.findById(id).lean();
    if (!appt) return res.status(404).json({ error: "Appointment not found" });
    if (!technicianIds.includes(String(appt.technicianId || ""))) {
      return res.status(403).json({ error: "You are not assigned to this appointment" });
    }

    const items = await ServiceToolUsage.find({ bookingId: id, technicianId: tech._id })
      .sort({ usedAt: -1 })
      .limit(300)
      .lean();

    return res.json({ items, count: items.length });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/technician/appointments/:id/tools
 * Body: { inventoryItemId, quantityUsed, notes }
 * Atomically deducts stock and creates usage record.
 */
router.post("/appointments/:id/tools", async (req, res, next) => {
  try {
    const BookingService = require("../models/BookingService");
    const Inventory = require("../models/Inventory");
    const ServiceToolUsage = require("../models/ServiceToolUsage");
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid appointment id" });

    const { tech, technicianIds } = await loadTechnicianContext(req.user._id);
    if (!tech) return res.status(404).json({ error: "Technician record not found" });

    const appt = await BookingService.findById(id);
    if (!appt) return res.status(404).json({ error: "Appointment not found" });
    if (!technicianIds.includes(String(appt.technicianId || ""))) {
      return res.status(403).json({ error: "You are not assigned to this appointment" });
    }
    if (String(appt.status || "").toLowerCase() === "cancelled") {
      return res.status(400).json({ error: "Cannot log tools for cancelled appointment" });
    }

    const inventoryItemId = String(req.body.inventoryItemId || "").trim();
    const quantityUsed = Number(req.body.quantityUsed);
    const notes = String(req.body.notes || "").trim();
    const fuelUsed = Number(req.body.fuelUsed);
    const toolCost = Number(req.body.toolCost);

    if (!mongoose.Types.ObjectId.isValid(inventoryItemId)) {
      return res.status(400).json({ error: "Select a valid tool item" });
    }
    if (!Number.isFinite(quantityUsed) || quantityUsed <= 0) {
      return res.status(400).json({ error: "Quantity used must be greater than zero" });
    }
    if (req.body.fuelUsed != null && (!Number.isFinite(fuelUsed) || fuelUsed < 0)) {
      return res.status(400).json({ error: "Fuel used must be a non-negative number" });
    }
    if (req.body.toolCost != null && (!Number.isFinite(toolCost) || toolCost < 0)) {
      return res.status(400).json({ error: "Tool cost must be a non-negative number" });
    }

    const updatedItem = await Inventory.findOneAndUpdate(
      {
        _id: inventoryItemId,
        active: true,
        isStockItem: true,
        quantity: { $gte: quantityUsed },
      },
      { $inc: { quantity: -quantityUsed } },
      { new: true },
    ).lean();

    if (!updatedItem) {
      return res.status(409).json({ error: "Insufficient stock or invalid tool item" });
    }

    const usageData = {
      bookingId: appt._id,
      technicianId: tech._id,
      inventoryItemId: updatedItem._id,
      itemName: updatedItem.itemName,
      unit: updatedItem.unit || "pcs",
      quantityUsed,
      unitPrice: Number(updatedItem.costPrice) || 0,
      deductedFromInventory: true,
      notes: notes.slice(0, 500),
      recordedBy: req.user._id,
    };
    if (Number.isFinite(fuelUsed)) usageData.fuelUsed = fuelUsed;
    if (Number.isFinite(toolCost)) usageData.toolCost = toolCost;
    if (!Number.isFinite(toolCost)) {
      usageData.toolCost = (Number(updatedItem.costPrice) || 0) * quantityUsed;
    }

    const usage = await ServiceToolUsage.create(usageData);

    await audit.logEvent({
      actor: req.user._id,
      target: appt._id,
      action: "tool.usage.create",
      module: "technician",
      req,
      details: {
        usageId: usage._id,
        inventoryItemId,
        quantityUsed,
        remainingQty: updatedItem.quantity,
        fuelUsed: usage.fuelUsed || 0,
        toolCost: usage.toolCost || 0,
      },
    });

    return res.status(201).json({
      message: "Tool usage recorded",
      usage,
      inventory: {
        _id: updatedItem._id,
        itemName: updatedItem.itemName,
        unit: updatedItem.unit,
        quantity: updatedItem.quantity,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/technician/tool-usage/:usageId
 * Removes one usage record and restores stock. Only own records.
 */
router.delete("/tool-usage/:usageId", async (req, res, next) => {
  try {
    const Inventory = require("../models/Inventory");
    const ServiceToolUsage = require("../models/ServiceToolUsage");
    const { tech } = await loadTechnicianContext(req.user._id);
    if (!tech) return res.status(404).json({ error: "Technician record not found" });

    const usageId = req.params.usageId;
    if (!mongoose.Types.ObjectId.isValid(usageId)) return res.status(400).json({ error: "Invalid usage id" });

    const usage = await ServiceToolUsage.findOne({ _id: usageId, technicianId: tech._id });
    if (!usage) return res.status(404).json({ error: "Tool usage record not found" });

    await Inventory.findByIdAndUpdate(usage.inventoryItemId, { $inc: { quantity: usage.quantityUsed } });
    await usage.deleteOne();

    await audit.logEvent({
      actor: req.user._id,
      target: usage.bookingId,
      action: "tool.usage.delete",
      module: "technician",
      req,
      details: {
        usageId,
        inventoryItemId: usage.inventoryItemId,
        restoredQty: usage.quantityUsed,
      },
    });

    return res.json({ message: "Tool usage removed and stock restored" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const admin = require("../controllers/adminController");
const auth = require("../middleware/authenticate");
const audit = require("../utils/audit");
const {
  listToolUsage,
  summarizeToolUsage,
  createToolUsageEntry,
  updateToolUsageEntry,
  deleteToolUsageEntry,
} = require("../utils/toolUsageManagement");

// Protect all admin API routes
router.use(auth.authenticate);
router.use(auth.requireRole("admin"));

// Customers
router.get("/customers", admin.listCustomers);
router.get("/customers/:id", admin.getCustomer);
router.get("/customers/:id/violations", admin.getCustomerViolations);
router.get("/customers/:id/bookings", admin.getCustomerBookingHistory);
router.patch("/customers/:id", admin.updateCustomer);

// Staff
router.get("/staff", admin.listStaff);
router.post("/staff", admin.createStaff);
router.patch("/staff/:id", admin.editStaff);
router.post("/staff/:id/reset-password", admin.resetStaffPassword);
router.get("/staff/:id/logs", admin.viewStaffActivityLogs);
router.get("/logs", admin.listLogs);

// Dashboard KPI summary (counts used by admin dashboard)
router.get("/analytics/summary", admin.analyticsSummary);

// Non-working days (day-offs) — admin can add/remove full-day blocked dates
router.get("/dayoffs", admin.listNonWorkingDays);
router.post("/dayoffs", admin.createNonWorkingDay);
router.delete("/dayoffs/:id", admin.deleteNonWorkingDay);

// Technician schedules
router.get("/technician-schedules", admin.listTechnicianSchedules);
router.get("/technician-schedules/:technicianId", admin.getTechnicianSchedule);
router.post("/technician-schedules", admin.upsertTechnicianSchedule);

// Technicians list for scheduling UI
router.get("/technicians", admin.listTechnicians);
router.get("/technicians/:id/calendar", admin.getTechnicianCalendar);

// Core service administration
router.get("/core-services", admin.listCoreServices);
router.get("/core-services/:id", admin.getCoreService);
router.post("/core-services", admin.createCoreService);
router.patch("/core-services/:id", admin.editCoreService);
// Repair service administration
router.get("/repair-services", admin.listRepairServices);
router.get("/repair-services/:id", admin.getRepairService);
router.post("/repair-services", admin.createRepairService);
router.patch("/repair-services/:id", admin.editRepairService);

// Inventory administration
router.get("/inventory", admin.listInventory);
router.post("/inventory", admin.createInventory);
router.patch("/inventory/:id", admin.editInventory);
router.delete("/inventory/:id", async (req, res, next) => {
  try {
    const Inventory = require("../models/Inventory");
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid inventory id" });
    }

    const item = await Inventory.findById(id);
    if (!item) return res.status(404).json({ error: "Inventory item not found" });

    item.active = false;
    await item.save();

    return res.json({ message: "Tool item archived", item });
  } catch (err) {
    next(err);
  }
});

// Payments administration
const paymentController = require("../controllers/paymentController");
router.get("/payments", paymentController.listPayments);
router.get("/payments/:id", paymentController.getPayment);
router.post("/payments", paymentController.createPayment);
router.patch("/payments/:id", paymentController.updatePayment);

// Tool usage management (admin)
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
    const Inventory = require("../models/Inventory");

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
      moduleName: "admin",
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
      moduleName: "admin",
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
      moduleName: "admin",
    });
    return res.json({ message: "Tool usage deleted and stock restored", ...result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ─── Fare / Pricing Settings ─────────────────────────────────────────────────
const SiteSetting = require("../models/SiteSetting");

/** GET /api/admin/settings/fare  — return the current fare per km value */
router.get("/settings/fare", async (req, res, next) => {
  try {
    const setting = await SiteSetting.findOne({ key: "farePerKm" }).lean();
    const farePerKm =
      setting && typeof setting.value === "number" ? setting.value : 40;
    return res.json({ farePerKm });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/admin/settings/fare  — update the fare per km */
router.patch("/settings/fare", async (req, res, next) => {
  try {
    const val = Number(req.body.farePerKm);
    if (!Number.isFinite(val) || val < 0 || val > 10000) {
      return res
        .status(400)
        .json({ error: "farePerKm must be a number between 0 and 10 000" });
    }
    const setting = await SiteSetting.findOneAndUpdate(
      { key: "farePerKm" },
      { value: val },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await audit.logEvent({
      actor: req.user._id,
      target: req.user._id,
      action: "settings.fare.update",
      module: "admin",
      req,
      details: { farePerKm: val },
    }).catch(() => {});
    return res.json({ farePerKm: setting.value, message: "Fare rate updated" });
  } catch (err) {
    next(err);
  }
});

// ─── Leave Requests (admin review) ───────────────────────────────────────────
const LeaveRequest = require("../models/LeaveRequest");

/**
 * GET  /api/admin/leave-requests          list all leave requests
 * Query params: ?status=pending|approved|rejected|all  ?technicianId=<id>
 */
router.get("/leave-requests", async (req, res, next) => {
  try {
    const q      = req.query || {};
    const filter = {};
    if (q.status && q.status !== "all") filter.status = q.status;
    if (q.technicianId && mongoose.Types.ObjectId.isValid(q.technicianId)) {
      filter.technicianId = q.technicianId;
    }
    const items = await LeaveRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    return res.json({ items, count: items.length });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/leave-requests/:id     approve or reject a leave request
 * Body: { status: "approved"|"rejected", adminNote?: string }
 */
router.patch("/leave-requests/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const leave = await LeaveRequest.findById(id);
    if (!leave) return res.status(404).json({ error: "Leave request not found" });

    const { status, adminNote } = req.body;
    if (!["approved", "rejected", "pending"].includes(status)) {
      return res.status(400).json({ error: "Status must be 'approved' or 'rejected'" });
    }

    leave.status     = status;
    leave.adminNote  = String(adminNote || "").trim().slice(0, 500);
    leave.reviewedBy = req.user._id;
    leave.reviewedAt = new Date();
    await leave.save();

    await logAction(req.user._id, leave.technicianId, `leave.${status}`, req, {
      leaveId:   id,
      adminNote: leave.adminNote,
    });

    return res.json({ message: `Leave request ${status}`, leave });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

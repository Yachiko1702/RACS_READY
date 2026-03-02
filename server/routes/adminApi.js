const express = require("express");
const router = express.Router();
const admin = require("../controllers/adminController");
const auth = require("../middleware/authenticate");

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

// Payments administration
const paymentController = require("../controllers/paymentController");
router.get("/payments", paymentController.listPayments);
router.get("/payments/:id", paymentController.getPayment);
router.post("/payments", paymentController.createPayment);
router.patch("/payments/:id", paymentController.updatePayment);

module.exports = router;

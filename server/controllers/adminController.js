const mongoose = require("mongoose");
const User = require("../models/User");
const ActivityLog = require("../models/ActivityLog");
const loginRateLimiter = require("../middleware/loginRateLimiter");

function sanitizeEmail(e) {
  return String(e || "")
    .trim()
    .replace(/[\$\{\}]/g, "")
    .toLowerCase();
}

function isPoint(obj) {
  if (
    !obj ||
    obj.type !== "Point" ||
    !Array.isArray(obj.coordinates) ||
    obj.coordinates.length !== 2
  )
    return false;
  const lng = Number(obj.coordinates[0]);
  const lat = Number(obj.coordinates[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return true;
}

const audit = require("../utils/audit");

async function logAction(actorId, targetId, action, req, details) {
  try {
    await audit.logEvent({
      actor: actorId,
      target: targetId,
      action,
      module: "admin",
      req,
      details,
    });
  } catch (e) {
    console.warn("ActivityLog error", e && e.message);
  }
}

exports.listCustomers = async (req, res, next) => {
  try {
    const customers = await User.find({ role: "customer" }).select(
      "-passwordHash -resetPasswordTokenHash -resetPasswordExpires",
    );
    res.json({ customers });
  } catch (err) {
    next(err);
  }
};

exports.getCustomer = async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "Invalid id" });
    const user = await User.findById(id).select(
      "-passwordHash -resetPasswordTokenHash -resetPasswordExpires",
    );
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user });
  } catch (err) {
    next(err);
  }
};

exports.updateCustomer = async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "Invalid id" });
    const action = req.body.action;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: "User not found" });

    switch (action) {
      case "block":
        user.blocked = true;
        await user.save();
        await logAction(req.user._id, user._id, "customer.block", req, {
          reason: req.body.reason || "",
        });
        return res.json({ message: "Customer blocked" });
      case "unblock":
        user.blocked = false;
        await user.save();
        await logAction(req.user._id, user._id, "customer.unblock", req, {});
        return res.json({ message: "Customer unblocked" });
      case "grant_vip":
        user.vip = true;
        await user.save();
        await logAction(req.user._id, user._id, "customer.grant_vip", req, {});
        return res.json({ message: "VIP granted" });
      case "revoke_vip":
        user.vip = false;
        await user.save();
        await logAction(req.user._id, user._id, "customer.revoke_vip", req, {});
        return res.json({ message: "VIP revoked" });
      case "set_booking_limit":
        const limit = Number(req.body.bookingLimit) || 0;
        user.bookingLimit = limit;
        await user.save();
        await logAction(
          req.user._id,
          user._id,
          "customer.set_booking_limit",
          req,
          { bookingLimit: limit },
        );
        return res.json({ message: "Booking limit set", bookingLimit: limit });
      case "reset_lock": {
        // clear rate limiter entry for this user's email
        loginRateLimiter.reset("email", user.email);
        await logAction(req.user._id, user._id, "customer.reset_lock", req, {});
        return res.json({ message: "Login lock cleared" });
      }
      default:
        return res.status(400).json({ error: "Unknown action" });
    }
  } catch (err) {
    next(err);
  }
};

exports.getCustomerViolations = async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "Invalid id" });
    const user = await User.findById(id).select("violations");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ violations: user.violations || [] });
  } catch (err) {
    next(err);
  }
};

exports.getCustomerBookingHistory = async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "Invalid id" });
    // Attempt to load Appointment model if available
    try {
      const Appointment = require("../models/Appointment");
      const bookings = await Appointment.find({ customer: id })
        .sort({ createdAt: -1 })
        .limit(200);
      return res.json({ bookings });
    } catch (e) {
      // If no Appointment model, return empty with helpful message
      return res.json({
        bookings: [],
        message: "No Appointment model available in this deployment.",
      });
    }
  } catch (err) {
    next(err);
  }
};

// Staff management
exports.listStaff = async (req, res, next) => {
  try {
    // 1) fetch Users that are staff (admin/secretary/technician)
    // only include real staff (secretaries and technicians), admins should not be listed here
    const users = await User.find({
      role: { $in: ["secretary", "technician"] },
    })
      .select("-passwordHash -resetPasswordTokenHash -resetPasswordExpires")
      .lean();

    // 2) load Technician docs and Secretary metadata so we can merge / enrich Users
    const Technician = require("../models/Technician");
    const Secretary = require("../models/Secretary");

    const [techs, secs] = await Promise.all([
      Technician.find({}).lean(),
      Secretary.find({}).lean(),
    ]);

    const techByUser = new Map();
    const techById = new Map();
    techs.forEach((t) => {
      if (t.user) techByUser.set(String(t.user), t);
      techById.set(String(t._id), t);
    });

    const secByUser = new Map();
    secs.forEach((s) => {
      if (s.user) secByUser.set(String(s.user), s);
    });

    // 3) transform users: attach technician/secretary metadata where available
    const transformedUsers = users.map((u) => {
      const out = Object.assign({}, u);
      const uid = String(u._id);
      // attach technician metadata when linked
      if (techByUser.has(uid)) {
        const t = techByUser.get(uid);
        out._tech = true;
        out.technicianId = t._id; // useful for schedule lookups
        out.location = out.location || t.location;
        // `skills` removed from Technician model
      }
      // attach secretary metadata when present
      if (secByUser.has(uid)) {
        const s = secByUser.get(uid);
        out._secretary = true;
        out.secretary = {
          extension: s.extension || "",
          shift: s.shift || "",
          notes: s.notes || "",
        };
      }
      return out;
    });

    // 4) include Technician-only entries (technicians that don't have a User account)
    const techOnly = techs
      .filter((t) => !t.user)
      .map((t) => ({
        _id: t._id,
        firstName: (t.name || "").split(" ")[0] || "",
        lastName: (t.name || "").split(" ").slice(1).join(" ") || "",
        role: "technician",
        active: typeof t.active === "boolean" ? t.active : true,
        // skills removed from model
        _tech: true,
      }));

    // 5) combine and return (prefer user records)
    const combined = [];
    const seen = new Set();
    transformedUsers.forEach((u) => {
      seen.add(String(u._id));
      combined.push(u);
    });
    techOnly.forEach((tu) => {
      if (!seen.has(String(tu._id))) combined.push(tu);
    });

    // compute user-based counts for KPI (exclude tech-only entries)
    const userTechCount = users.filter((u) => u.role === "technician").length;
    const userSecretaryCount = users.filter(
      (u) => u.role === "secretary",
    ).length;
    const userTotalCount = users.length;

    res.json({
      staff: combined,
      userCounts: {
        total: userTotalCount,
        technicians: userTechCount,
        secretaries: userSecretaryCount,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.createStaff = async (req, res, next) => {
  try {
    let { email, password, role, firstName, lastName, phone, location } =
      req.body;
    email = sanitizeEmail(email);
    // admins should not be created via this interface (they are managed separately)
    if (role === "admin") {
      return res
        .status(400)
        .json({ error: "Cannot create admin via this form" });
    }
    role = ["secretary", "technician"].includes(role) ? role : "secretary";
    // input validation with clearer feedback
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }
    if (!password || typeof password !== "string") {
      return res.status(400).json({ error: "Password is required" });
    }
    // enforce the same constraints used in password reset: 8-12 alphanumeric
    if (password.length < 8 || password.length > 12) {
      return res
        .status(400)
        .json({ error: "Password must be 8-12 characters" });
    }
    if (!/^[A-Za-z0-9]+$/.test(password)) {
      return res
        .status(400)
        .json({ error: "Password must contain only letters and numbers" });
    }
    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ error: "User already exists" });

    // create User (staff account)
    const user = new User({
      email,
      role,
      active: true,
      firstName: firstName || "",
      lastName: lastName || "",
      phone: phone || "",
    });
    await user.setPassword(password);
    await user.save();

    // if technician (or admin-as-technician), also create a Technician document and link where appropriate
    let techDoc = null;

    // if secretary, create a lightweight secretary profile so metadata can be stored later
    if (role === "secretary") {
      try {
        const Secretary = require("../models/Secretary");
        const secPayload = {
          user: user._id,
          phone: user.phone || undefined,
          extension: "",
          shift: "",
          notes: "",
        };
        const secDoc = new Secretary(secPayload);
        await secDoc.save();
      } catch (e) {
        // failure to create secretary metadata shouldn't block user creation
        console.warn("unable to create secretary profile", e && e.message);
      }
    }

    if (role === "technician" || role === "admin") {
      const Technician = require("../models/Technician");
      const tName =
        `${(firstName || "").trim()} ${(lastName || "").trim()}`.trim() ||
        email;
      const techPayload = {
        user: user._id,
        userEmail: user.email,
        phone: user.phone || undefined,
        name: tName,
        active: true,
      };
      // Accept either a simple address string (locationText) or a GeoJSON Point for `location`
      if (typeof location === "string" && location.trim()) {
        techPayload.locationText = String(location).trim();
      } else if (location) {
        // validate GeoJSON Point
        if (!isPoint(location))
          return res.status(400).json({ error: "invalid location" });
        techPayload.location = {
          type: "Point",
          coordinates: [
            Number(location.coordinates[0]),
            Number(location.coordinates[1]),
          ],
        };
      }

      techDoc = new Technician(techPayload);
      await techDoc.save();

      // mark the user as technician (already set in role) and add reference in meta
      user.meta = user.meta || {};
      user.meta.technicianId = techDoc._id;
      await user.save();
    }

    await logAction(req.user._id, user._id, "staff.create", req, {
      role,
      technicianId: techDoc?._id,
    });
    res.status(201).json({
      message: "Staff created",
      user: { id: user._id, email: user.email, role: user.role },
      technician: techDoc,
    });
  } catch (err) {
    next(err);
  }
};

exports.editStaff = async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "Invalid id" });
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: "User not found" });
    const { role, active } = req.body;
    if (role && ["admin", "secretary"].includes(role)) user.role = role;
    if (typeof active === "boolean") user.active = active;
    await user.save();
    await logAction(req.user._id, user._id, "staff.edit", req, {
      role: user.role,
      active: user.active,
    });
    res.json({ message: "Staff updated" });
  } catch (err) {
    next(err);
  }
};

exports.resetStaffPassword = async (req, res, next) => {
  try {
    const id = req.params.id;
    const { newPassword } = req.body;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "Invalid id" });
    if (!newPassword || newPassword.length < 8 || newPassword.length > 20)
      return res.status(400).json({ error: "Invalid password" });
    if (!/^[A-Za-z0-9]+$/.test(newPassword))
      return res.status(400).json({ error: "Invalid password" });
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: "User not found" });
    await user.setPassword(newPassword);
    await user.save();
    await logAction(req.user._id, user._id, "staff.reset_password", req, {});
    res.json({ message: "Password reset" });
  } catch (err) {
    next(err);
  }
};

exports.viewStaffActivityLogs = async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "Invalid id" });
    const logs = await ActivityLog.find({
      $or: [{ actor: id }, { target: id }],
    })
      .sort({ createdAt: -1 })
      .limit(200);
    res.json({ logs });
  } catch (err) {
    next(err);
  }
};

// General activity logs (admin UI)
exports.listLogs = async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 200);
    const logs = await ActivityLog.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("actor", "email")
      .populate("target", "email")
      .lean();
    const out = logs.map((l) => ({
      _id: l._id,
      actor: l.actor ? l.actor._id : null,
      actorEmail: l.actor ? l.actor.email : null,
      target: l.target ? l.target._id : null,
      targetEmail: l.target ? l.target.email : null,
      action: l.action,
      details: l.details || {},
      ip: l.ip || "",
      createdAt: l.createdAt,
    }));
    res.json({ logs: out });
  } catch (err) {
    next(err);
  }
};

// Analytics summary used by admin dashboard (returns counts + small item lists)
exports.analyticsSummary = async (req, res, next) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    let todaysAppointments = 0;
    let pendingBookingRequests = 0;
    let activeJobsInProgress = 0;
    let completedJobsToday = 0;
    let todaysAppointmentsItems = [];
    let activeJobsItems = [];
    let lowStockCount = 0;
    let lowStockItems = [];
    let revenueToday = null;

    // Preferred source: BookingService (if present)
    try {
      const BookingService = require("../models/BookingService");
      todaysAppointments = await BookingService.countDocuments({
        bookingDate: { $gte: startOfDay, $lte: endOfDay },
      });
      pendingBookingRequests = await BookingService.countDocuments({
        status: "pending",
      });
      activeJobsInProgress = await BookingService.countDocuments({
        status: "confirmed",
        bookingDate: { $gte: startOfDay, $lte: endOfDay },
      });
      completedJobsToday = await BookingService.countDocuments({
        status: "completed",
        bookingDate: { $gte: startOfDay, $lte: endOfDay },
      });

      const items = await BookingService.find({
        bookingDate: { $gte: startOfDay, $lte: endOfDay },
      })
        .sort({ startTime: 1 })
        .limit(20)
        .populate("customerId", "firstName lastName email")
        .populate("technicianId", "firstName lastName")
        .lean();
      todaysAppointmentsItems = items.map((it) => ({
        _id: it._id,
        customerName:
          // prefer the snapshot field if available (new schema)
          (it.customer && it.customer.name) ||
          (it.customerId
            ? (
                (it.customerId.firstName || "") +
                " " +
                (it.customerId.lastName || "")
              ).trim()
            : it.customer || "Customer"),
        service: it.serviceType || "",
        time: it.startTime || "",
        status: it.status,
      }));

      // Active jobs list (sample of in-progress/confirmed bookings)
      const activeJobs = await BookingService.find({
        status: { $in: ["confirmed", "in-progress", "ongoing"] },
        bookingDate: { $gte: startOfDay, $lte: endOfDay },
      })
        .limit(6)
        .populate("technicianId", "firstName lastName")
        .lean();
      activeJobsItems = activeJobs.map((a) => ({
        _id: a._id,
        title: a.serviceType || "Service",
        location: a.location && a.location.address ? a.location.address : "",
        technicianName:
          (a.technician && a.technician.name) ||
          (a.technicianId
            ? (
                (a.technicianId.firstName || "") +
                " " +
                (a.technicianId.lastName || "")
              ).trim()
            : ""),
        eta: a.startTime || "",
        status: a.status,
      }));
    } catch (e) {
      // fallback: derive rough counts from ActivityLog actions if BookingService isn't available
      try {
        const logsToday = await ActivityLog.find({
          action: /appointment/i,
          createdAt: { $gte: startOfDay, $lte: endOfDay },
        }).lean();
        todaysAppointments = logsToday.length;
        completedJobsToday = logsToday.filter((l) =>
          /complete|completed/i.test(l.action),
        ).length;
      } catch (xx) {
        // ignore - keep zeros
      }
    }

    // low stock: attempt to read Inventory model if present
    try {
      const Inventory = require("../models/Inventory");
      const low = await Inventory.find({ stock: { $lte: 5 } })
        .limit(20)
        .lean();
      lowStockItems = low;
      lowStockCount = Array.isArray(low) ? low.length : 0;
    } catch (e) {
      lowStockCount = 0;
      lowStockItems = [];
    }

    // revenue: optional — attempt to read Payment/Order model if available
    try {
      const Payment = require("../models/Payment");
      const agg = await Payment.aggregate([
        {
          $match: {
            createdAt: { $gte: startOfDay, $lte: endOfDay },
            status: "paid",
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);
      revenueToday = agg && agg[0] ? agg[0].total : null;
    } catch (e) {
      revenueToday = null; // not available in this deployment
    }

    res.json({
      todaysAppointments,
      pendingBookingRequests,
      activeJobsInProgress,
      completedJobsToday,
      todaysAppointmentsItems,
      activeJobsItems,
      lowStockCount,
      lowStockItems,
      revenueToday,
      revenueCurrency: "PHP",
    });
  } catch (err) {
    next(err);
  }
};

// (TimeSlot-related endpoints removed)

// --- Non-working days (admin) -------------------------------------------------
// GET /api/admin/dayoffs?date=YYYY-MM-DD | startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&serviceId=
exports.listNonWorkingDays = async (req, res, next) => {
  try {
    const { date, startDate, endDate, serviceId } = req.query;
    const q = {};

    if (date) {
      const d = new Date(date + "T00:00:00");
      if (Number.isNaN(d.getTime()))
        return res.status(400).json({ error: "invalid date" });
      q.date = d;
    }

    if (startDate || endDate) {
      const sd = startDate ? new Date(startDate + "T00:00:00") : null;
      const ed = endDate ? new Date(endDate + "T00:00:00") : null;
      if (
        (sd && Number.isNaN(sd.getTime())) ||
        (ed && Number.isNaN(ed.getTime()))
      )
        return res.status(400).json({ error: "invalid startDate or endDate" });
      q.date = {};
      if (sd) q.date.$gte = sd;
      if (ed) {
        ed.setHours(23, 59, 59, 999);
        q.date.$lte = ed;
      }
    }

    if (serviceId) {
      if (!mongoose.Types.ObjectId.isValid(serviceId))
        return res.status(400).json({ error: "invalid serviceId" });
      q.service = serviceId;
    }

    const NonWorkingDay = require("../models/NonWorkingDay");
    const docs = await NonWorkingDay.find(q).sort({ date: 1 }).lean();
    return res.json({ dayoffs: docs });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/dayoffs  (create single day-off)
// body: { date: 'YYYY-MM-DD', serviceId?, note?, force? }
exports.createNonWorkingDay = async (req, res, next) => {
  try {
    const { date, serviceId, note, force } = req.body || {};
    if (!date)
      return res.status(400).json({ error: "date is required (YYYY-MM-DD)" });
    const d = new Date(date + "T00:00:00");
    if (Number.isNaN(d.getTime()))
      return res.status(400).json({ error: "invalid date" });
    const NonWorkingDay = require("../models/NonWorkingDay");
    const doc = new NonWorkingDay({
      date: d,
      service:
        serviceId && mongoose.Types.ObjectId.isValid(serviceId)
          ? serviceId
          : undefined,
      note: note || "",
    });
    await doc.save();

    await logAction(req.user._id, doc._id, "dayoff.create", req, {
      date,
      serviceId,
      force: !!force,
    });
    return res.status(201).json({ dayoff: doc });
  } catch (err) {
    if (err && err.code === 11000)
      return res
        .status(409)
        .json({ error: "Day off already exists for that date/scope" });
    next(err);
  }
};

// DELETE /api/admin/dayoffs/:id
exports.deleteNonWorkingDay = async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "Invalid id" });
    const NonWorkingDay = require("../models/NonWorkingDay");
    const d = await NonWorkingDay.findByIdAndDelete(id);
    if (!d) return res.status(404).json({ error: "Day off not found" });
    await logAction(req.user._id, d._id, "dayoff.delete", req, {});
    return res.json({ message: "deleted" });
  } catch (err) {
    next(err);
  }
};

// ------------------------- Core Service management --------------------------
// these endpoints power the admin UI for creating/editing core service catalog

// GET /api/admin/core-services
exports.listCoreServices = async (req, res, next) => {
  try {
    const CoreService = require("../models/CoreService");
    const docs = await CoreService.find({}).lean();
    return res.json({ coreServices: docs });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/core-services/:id
exports.getCoreService = async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "invalid id" });
    const CoreService = require("../models/CoreService");
    const svc = await CoreService.findById(id).lean();
    if (!svc) return res.status(404).json({ error: "not found" });
    return res.json({ coreService: svc });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/core-services  (body: service fields)
exports.createCoreService = async (req, res, next) => {
  try {
    const {
      name,
      slug,
      category,
      description,
      basePrice,
      durationMinutes,
      active,
    } = req.body || {};
    if (!name || !slug || !category)
      return res
        .status(400)
        .json({ error: "name, slug and category are required" });
    const CoreService = require("../models/CoreService");
    const existing = await CoreService.findOne({ slug });
    if (existing) return res.status(409).json({ error: "slug already exists" });
    const svc = new CoreService({
      name,
      slug,
      category,
      description,
      basePrice,
      durationMinutes,
      active: active !== false,
    });
    await svc.save();
    await logAction(req.user._id, svc._id, "coreService.create", req, {
      slug,
    });
    return res.status(201).json({ coreService: svc });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/admin/core-services/:id (body: fields to update)
exports.editCoreService = async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "invalid id" });
    const updates = req.body || {};
    if (updates.slug) {
      const CoreService = require("../models/CoreService");
      const other = await CoreService.findOne({
        slug: updates.slug,
        _id: { $ne: id },
      });
      if (other) return res.status(409).json({ error: "slug already exists" });
    }
    const CoreService = require("../models/CoreService");
    const svc = await CoreService.findByIdAndUpdate(id, updates, {
      new: true,
    }).lean();
    if (!svc) return res.status(404).json({ error: "not found" });
    await logAction(req.user._id, svc._id, "coreService.update", req, {
      updates,
    });
    return res.json({ coreService: svc });
  } catch (err) {
    next(err);
  }
};

// ------------------------- Repair Service management ------------------------
// thorough-but-simple CRUD for repair service catalog

// GET /api/admin/repair-services
exports.listRepairServices = async (req, res, next) => {
  try {
    const RepairService = require("../models/RepairService");
    const docs = await RepairService.find({}).lean();
    return res.json({ repairServices: docs });
  } catch (err) {
    next(err);
  }
};

// -----------------------------------------------------------------------------
// Inventory administration
// GET/POST inventory items for the admin panel
exports.listInventory = async (req, res, next) => {
  try {
    const Inventory = require("../models/Inventory");
    const docs = await Inventory.find({})
      .populate("category", "name")
      .populate("brand", "name")
      .lean();
    return res.json({ inventory: docs });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/inventory
exports.createInventory = async (req, res, next) => {
  try {
    const {
      itemName,
      barcode,
      category,
      brand,
      costPrice,
      quantity,
      minStockLevel,
      sellingPrice,
      supplier,
      unit,
      variant,
      size,
      specification,
      isStockItem,
      salesChannel,
      active,
      description,
    } = req.body || {};
    if (!itemName)
      return res.status(400).json({ error: "itemName is required" });
    const Inventory = require("../models/Inventory");
    const Category = require("../models/Category");
    const Brand = require("../models/Brand");
    let categoryId = null;
    if (category) {
      // category may be name or ObjectId
      let cat = null;
      if (mongoose.Types.ObjectId.isValid(category)) {
        cat = await Category.findById(category);
      }
      if (!cat) {
        cat = await Category.findOne({ name: category });
      }
      if (!cat) {
        cat = await Category.create({ name: category });
      }
      categoryId = cat._id;
    }
    let brandId = null;
    if (brand) {
      let br = null;
      if (mongoose.Types.ObjectId.isValid(brand)) {
        br = await Brand.findById(brand);
      }
      if (!br) {
        br = await Brand.findOne({ name: brand });
      }
      if (!br) {
        br = await Brand.create({ name: brand });
      }
      brandId = br._id;
    }
    const inv = new Inventory({
      itemName,
      barcode: barcode || undefined,
      category: categoryId,
      brand: brandId,
      costPrice: costPrice || 0,
      quantity: quantity || 0,
      minStockLevel: minStockLevel || 0,
      sellingPrice: sellingPrice || 0,
      supplier: supplier || undefined,
      unit: unit || undefined,
      variant: variant || undefined,
      size: size || undefined,
      specification: specification || undefined,
      isStockItem: isStockItem !== false,
      salesChannel: salesChannel || undefined,
      active: active !== false,
    });
    await inv.save();
    await logAction(req.user._id, inv._id, "inventory.create", req, {
      itemName,
    });
    return res.status(201).json({ inventory: inv });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/admin/inventory/:id
exports.editInventory = async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "invalid id" });
    const updates = req.body || {};
    const Inventory = require("../models/Inventory");
    const Category = require("../models/Category");
    const Brand = require("../models/Brand");

    if (updates.category) {
      let cat = null;
      if (mongoose.Types.ObjectId.isValid(updates.category)) {
        cat = await Category.findById(updates.category);
      }
      if (!cat) {
        cat = await Category.findOne({ name: updates.category });
      }
      if (!cat) {
        cat = await Category.create({ name: updates.category });
      }
      updates.category = cat._id;
    }
    if (updates.brand) {
      let br = null;
      if (mongoose.Types.ObjectId.isValid(updates.brand)) {
        br = await Brand.findById(updates.brand);
      }
      if (!br) {
        br = await Brand.findOne({ name: updates.brand });
      }
      if (!br) {
        br = await Brand.create({ name: updates.brand });
      }
      updates.brand = br._id;
    }

    const inv = await Inventory.findByIdAndUpdate(id, updates, {
      new: true,
    }).lean();
    if (!inv) return res.status(404).json({ error: "not found" });
    await logAction(req.user._id, inv._id, "inventory.update", req, {
      updates,
    });
    return res.json({ inventory: inv });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/repair-services/:id
exports.getRepairService = async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "invalid id" });
    const RepairService = require("../models/RepairService");
    const svc = await RepairService.findById(id).lean();
    if (!svc) return res.status(404).json({ error: "not found" });
    return res.json({ repairService: svc });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/repair-services
exports.createRepairService = async (req, res, next) => {
  try {
    const {
      name,
      slug,
      applianceType,
      basePrice,
      estimatedDurationMinutes,
      active,
    } = req.body || {};
    if (!name || !slug)
      return res.status(400).json({ error: "name and slug are required" });
    const RepairService = require("../models/RepairService");
    const existing = await RepairService.findOne({ slug });
    if (existing) return res.status(409).json({ error: "slug already exists" });
    const svc = new RepairService({
      name,
      slug,
      applianceType,
      basePrice,
      estimatedDurationMinutes,
      active: active !== false,
    });
    await svc.save();
    await logAction(req.user._id, svc._id, "repairService.create", req, {
      slug,
    });
    return res.status(201).json({ repairService: svc });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/admin/repair-services/:id
exports.editRepairService = async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "invalid id" });
    const updates = req.body || {};
    if (updates.slug) {
      const RepairService = require("../models/RepairService");
      const other = await RepairService.findOne({
        slug: updates.slug,
        _id: { $ne: id },
      });
      if (other) return res.status(409).json({ error: "slug already exists" });
    }
    const RepairService = require("../models/RepairService");
    const svc = await RepairService.findByIdAndUpdate(id, updates, {
      new: true,
    }).lean();
    if (!svc) return res.status(404).json({ error: "not found" });
    await logAction(req.user._id, svc._id, "repairService.update", req, {
      updates,
    });
    return res.json({ repairService: svc });
  } catch (err) {
    next(err);
  }
};

// --- TechnicianSchedule endpoints -------------------------------------------------
exports.listTechnicianSchedules = async (req, res, next) => {
  try {
    // schedules are stored on TechnicianSchedule (single source of truth)
    const TechnicianSchedule = require("../models/TechnicianSchedule");
    const docs = await TechnicianSchedule.find({})
      .populate("technician", "name")
      .lean();
    const schedules = (docs || []).map((d) => ({
      technicianId: d.technicianId,
      technicianName: d.technician ? d.technician.name : "",
      workingDays: d.workingDays || [],
      restDates: d.restDates || [],
    }));
    return res.json({ schedules });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/technicians  (simple list used by scheduling UI)
exports.listTechnicians = async (req, res, next) => {
  try {
    // prevent clients from caching technician location data; we rely on frequent polls
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    const Technician = require("../models/Technician");
    // return active technicians; include location so the admin list can show map
    const docs = await Technician.find({ active: true })
      .select(
        "name userEmail phone location locationText active avatarUrl avatar skills",
      )
      .lean();
    return res.json({ technicians: docs });
  } catch (err) {
    next(err);
  }
};

exports.getTechnicianSchedule = async (req, res, next) => {
  try {
    const techId = req.params.technicianId;
    if (!mongoose.Types.ObjectId.isValid(techId))
      return res.status(400).json({ error: "invalid technicianId" });
    const TechnicianSchedule = require("../models/TechnicianSchedule");
    const doc = await TechnicianSchedule.findOne({
      technicianId: techId,
    }).lean();
    if (!doc)
      return res.json({
        schedule: {
          technicianId: techId,
          workingDays: [],
          nonWorkingWeekdays: [],
          restDates: [],
        },
      });
    return res.json({
      schedule: {
        technicianId: doc.technicianId,
        workingDays: doc.workingDays || [],
        nonWorkingWeekdays: (doc.nonWorkingWeekdays || []).map(
          (n) => n.dayOfWeek,
        ),
        restDates: doc.restDates || [],
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/technicians/:id/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD
// Returns merged calendar events for a technician by combining Technician, TechnicianSchedule and NonWorkingDay
exports.getTechnicianCalendar = async (req, res, next) => {
  try {
    const techId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(techId))
      return res.status(400).json({ error: "invalid technicianId" });

    const start = req.query.start
      ? new Date(req.query.start + "T00:00:00")
      : null;
    const end = req.query.end ? new Date(req.query.end + "T00:00:00") : null;

    // validate start/end parameters if provided
    if (
      (start && Number.isNaN(start.getTime())) ||
      (end && Number.isNaN(end.getTime()))
    )
      return res.status(400).json({ error: "invalid start/end" });

    const Technician = require("../models/Technician");
    const tech = await Technician.findById(techId).lean();
    if (!tech) return res.status(404).json({ error: "Technician not found" });

    const TechnicianSchedule = require("../models/TechnicianSchedule");
    const sched = (await TechnicianSchedule.findOne({
      technicianId: techId,
    }).lean()) || { workingDays: [], restDates: [] };

    const NonWorkingDay = require("../models/NonWorkingDay");
    const ndq = {};
    if (start || end) ndq.date = {};
    if (start) ndq.date.$gte = start;
    if (end) {
      const ed = new Date(end);
      ed.setHours(23, 59, 59, 999);
      ndq.date.$lte = ed;
    }
    const nonWorkingDocs = await NonWorkingDay.find(ndq).lean();

    // helper: format a date to local YYYY-MM-DD (avoid UTC shifts)
    function localDateKey(d) {
      const dt = new Date(d);
      dt.setHours(0, 0, 0, 0);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, "0");
      const day = String(dt.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }

    const nonWorkingMap = new Map();
    (nonWorkingDocs || []).forEach((n) => {
      const k = localDateKey(n.date);
      nonWorkingMap.set(k, { note: n.note || "", reason: n.reason || "" });
    });

    const restMap = new Map();
    (sched.restDates || []).forEach((r) => {
      const k = localDateKey(r.date);
      restMap.set(k, { _id: r._id, reason: r.reason || "" });
    });

    // determine iteration range
    let sDate = start ? new Date(start) : null;
    let eDate = end ? new Date(end) : null;
    if (!sDate || !eDate) {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      sDate = new Date(now);
      eDate = new Date(now);
      eDate.setDate(now.getDate() + 30);
    }
    const events = [];

    // helper: parse minute-based or HH:MM times into minute-of-day
    function parseMinuteValue(value) {
      if (value === null || value === undefined) return NaN;
      const raw = String(value).trim();
      if (!raw) return NaN;
      if (/^\d{1,4}$/.test(raw)) return Number(raw);
      const hm = raw.match(/^(\d{1,2}):(\d{2})$/);
      if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
      const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      if (ampm) {
        let hh = Number(ampm[1]) % 12;
        if (ampm[3].toUpperCase() === "PM") hh += 12;
        return hh * 60 + Number(ampm[2]);
      }
      return NaN;
    }

    function mergeRanges(ranges) {
      if (!ranges.length) return [];
      const sorted = ranges
        .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
        .sort((a, b) => a.start - b.start);
      if (!sorted.length) return [];
      const merged = [sorted[0]];
      for (let i = 1; i < sorted.length; i++) {
        const cur = sorted[i];
        const last = merged[merged.length - 1];
        if (cur.start <= last.end) {
          last.end = Math.max(last.end, cur.end);
        } else {
          merged.push({ ...cur });
        }
      }
      return merged;
    }

    const BookingService = require("../models/BookingService");
    const busyStatuses = ["pending", "confirmed", "in-progress", "ongoing", "re-scheduled"];
    const rangeStart = new Date(sDate);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(eDate);
    rangeEnd.setHours(23, 59, 59, 999);

    // include both technician._id and linked user id (legacy mixed references)
    const techIdsToMatch = [String(tech._id)];
    if (tech.user) techIdsToMatch.push(String(tech.user));

    const bookings = await BookingService.find({
      bookingDate: { $gte: rangeStart, $lte: rangeEnd },
      status: { $in: busyStatuses },
      technicianId: { $in: Array.from(new Set(techIdsToMatch)) },
    }).lean();

    const busyByDate = new Map();
    for (const b of bookings) {
      if (!b.bookingDate) continue;
      const key = localDateKey(b.bookingDate);
      const bStart = parseMinuteValue(b.startTime);
      if (!Number.isFinite(bStart)) continue;
      const explicitEnd = parseMinuteValue(b.endTime);
      const fallbackDur = (Number(b.serviceDurationMinutes) || 60) + Math.max(0, Number(b.travelTime) || 0);
      const bEnd = Number.isFinite(explicitEnd) && explicitEnd > bStart ? explicitEnd : bStart + fallbackDur;
      if (!Number.isFinite(bEnd) || bEnd <= bStart) continue;
      if (!busyByDate.has(key)) busyByDate.set(key, []);
      busyByDate.get(key).push({
        start: bStart,
        end: bEnd,
        title: b.bookingReference ? `Booked (${b.bookingReference})` : "Booked",
      });
    }
    for (const [k, ranges] of busyByDate.entries()) {
      busyByDate.set(k, mergeRanges(ranges));
    }

    const cur = new Date(sDate);
    while (cur <= eDate) {
      const day = cur.getDay(); // 0=Sunday, 1=Monday...

      const working = (sched.workingDays || []).find(
        (w) => w.dayOfWeek === day,
      );

      const key = localDateKey(cur);

      const isHoliday = nonWorkingMap.has(key);
      const isRest = restMap.has(key);

      const dayBusy = busyByDate.get(key) || [];

      if (working && !isHoliday && !isRest) {
        // subtract busy ranges from working block so calendar truly reflects blocked time
        let cursor = working.startMinutes;
        for (const br of dayBusy) {
          const s = Math.max(working.startMinutes, br.start);
          const e = Math.min(working.endMinutes, br.end);
          if (e <= s) continue;
          if (s > cursor) {
            const avStart = new Date(cur);
            avStart.setMinutes(cursor);
            const avEnd = new Date(cur);
            avEnd.setMinutes(s);
            events.push({
              title: "Available",
              start: avStart,
              end: avEnd,
              display: "background",
              color: "#28a745",
            });
          }
          cursor = Math.max(cursor, e);
        }
        if (cursor < working.endMinutes) {
          const avStart = new Date(cur);
          avStart.setMinutes(cursor);
          const avEnd = new Date(cur);
          avEnd.setMinutes(working.endMinutes);
          events.push({
            title: "Available",
            start: avStart,
            end: avEnd,
            display: "background",
            color: "#28a745",
          });
        }
      }

      // foreground blocked booking events
      for (const br of dayBusy) {
        const bs = new Date(cur);
        bs.setMinutes(br.start);
        const be = new Date(cur);
        be.setMinutes(br.end);
        events.push({
          title: br.title || "Booked",
          start: bs,
          end: be,
          color: "#dc3545",
          display: "auto",
          extendedProps: { blocked: true },
        });
      }

      if (isHoliday) {
        events.push({
          title: "Holiday",
          start: key,
          allDay: true,
          color: "#dc3545",
        });
      }

      if (isRest) {
        events.push({
          title: "Rest Day",
          start: key,
          allDay: true,
          color: "#ffc107",
        });
      }

      cur.setDate(cur.getDate() + 1);
    }

    const holidays = (nonWorkingDocs || []).map((n) => ({
      _id: n._id,
      date: localDateKey(n.date),
      note: n.note || "",
      reason: n.reason || "",
    }));

    const out = {
      _id: tech._id,
      name:
        tech.name ||
        ((tech.firstName || "") + " " + (tech.lastName || "")).trim() ||
        tech.userEmail ||
        "",
      location: tech.location || tech.locationText || null,
      schedule: {
        workingDays: sched.workingDays || [],
        nonWorkingWeekdays: (sched.nonWorkingWeekdays || []).map(
          (n) => n.dayOfWeek,
        ),
        restDates: (sched.restDates || []).map((r) => ({
          _id: r._id,
          date: localDateKey(r.date),
          reason: r.reason || "",
        })),
      },
      holidays,
      events,
    };

    return res.json(out);
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/technician-schedules  (create/update)
exports.upsertTechnicianSchedule = async (req, res, next) => {
  try {
    const { technicianId, workingDays, restDates } = req.body || {};
    // sanitize workingDays: ensure numeric fields, valid dow, start<end, and sort
    const rawWd = Array.isArray(workingDays) ? workingDays : [];
    const wd = rawWd
      .map((w) => ({
        dayOfWeek: Number(w.dayOfWeek),
        startMinutes: Number(w.startMinutes),
        endMinutes: Number(w.endMinutes),
      }))
      .filter(
        (w) =>
          Number.isInteger(w.dayOfWeek) &&
          w.dayOfWeek >= 0 &&
          w.dayOfWeek < 7 &&
          typeof w.startMinutes === "number" &&
          typeof w.endMinutes === "number" &&
          w.startMinutes < w.endMinutes,
      )
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    // derive nonWorkingWeekdays as the complement of wd over 0..6
    const allDays = [0, 1, 2, 3, 4, 5, 6];
    const nwNums = allDays.filter((d) => !wd.some((w) => w.dayOfWeek === d));
    // store as array of embedded docs to satisfy schema
    const nw = nwNums.map((d) => ({ dayOfWeek: d }));
    const rd = Array.isArray(restDates)
      ? restDates.map((r) => ({
          date: new Date((r.date || "") + "T00:00:00"),
          reason: String(r.reason || "")
            .trim()
            .substring(0, 200),
        }))
      : [];
    const Technician = require("../models/Technician");
    const TechnicianSchedule = require("../models/TechnicianSchedule");
    // helper: apply schedule to single technician (no TimeSlot updates)
    async function applyScheduleToTech(tid) {
      // upsert new schedule
      const updated = await TechnicianSchedule.findOneAndUpdate(
        { technicianId: tid },
        { $set: { workingDays: wd, nonWorkingWeekdays: nw, restDates: rd } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      return updated;
    }

    // apply to all technicians when technicianId === 'ALL'
    if (technicianId === "ALL") {
      const techs = await Technician.find({}).select("_id").lean();
      for (const t of techs) {
        await applyScheduleToTech(t._id);
      }
      await logAction(
        req.user._id,
        null,
        "technicianSchedule.upsert_all",
        req,
        {},
      );
      return res.json({ message: "applied_to_all" });
    }

    if (!technicianId || !mongoose.Types.ObjectId.isValid(technicianId))
      return res.status(400).json({ error: "technicianId is required" });

    const techExists = await Technician.findById(technicianId).lean();
    if (!techExists)
      return res.status(404).json({ error: "Technician not found" });

    const doc = await applyScheduleToTech(technicianId);
    await logAction(
      req.user._id,
      technicianId,
      "technicianSchedule.upsert",
      req,
      { technicianId },
    );
    return res.json({
      schedule: {
        technicianId: doc.technicianId,
        workingDays: doc.workingDays || [],
        restDates: doc.restDates || [],
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/timeslots/regenerate  (body: { days = 60, technicianId? })
exports.regenerateTimeSlots = async (req, res, next) => {
  // TimeSlot regeneration removed — endpoint deprecated
  return res.json({ message: "deprecated" });
};

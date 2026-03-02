const express = require("express");
const router = express.Router();

const defaultTechnicianLocation = {
  lat: 14.676049,
  lng: 121.043731,
};

const auth = require("../middleware/authenticate");
const pageAuth = require("../middleware/pageAuth");

function generateMathCaptcha() {
  const num1 = Math.floor(Math.random() * 10) + 1;
  const num2 = Math.floor(Math.random() * 10) + 1;
  const question = `What is ${num1} + ${num2}?`;
  const answer = num1 + num2;
  return { question, answer };
}

// lightweight endpoint that returns a fresh math captcha question and answer.
// used by client-side scripts so the user can reload the captcha without
// reloading the whole auth page.
router.get("/math-captcha", (req, res) => {
  const { question, answer } = generateMathCaptcha();
  res.json({ question, answer });
});

// Landing page
router.get("/", (req, res) => {
  res.render("pages/landing", { title: "CALIDRO RACS" });
});

// Services page
// when rendering the booking UI we can also preload the service catalog so that
// the client has something to show immediately (and the page is usable without JS).
// This also ensures we're pulling from the CoreService/RepairService collections
// instead of the legacy `Service` model.
const CoreService = require("../models/CoreService");
const RepairService = require("../models/RepairService");

router.get("/services", async (req, res) => {
  let initialServices = { coreServices: [], repairs: [] };
  try {
    const core = await CoreService.find({ active: true }).lean().limit(100);
    const repairs = await RepairService.find({ active: true })
      .lean()
      .limit(100);
    initialServices = { coreServices: core, repairs };
  } catch (err) {
    // log but don't block rendering; client will still fetch via API later
    console.error(
      "/services page failed to preload services:",
      err && err.message,
    );
  }

  res.render("pages/services", {
    title: "Our Services",
    googleCalendarClientId: process.env.GOOGLE_CALENDAR_CLIENT_ID || "",
    technicianLocation: defaultTechnicianLocation,
    initialServices,
    // supply the admin's GCash number for the QR code
    adminGcashNumber: process.env.ADMIN_GCASH_NUMBER || "",
  });
});

// Products page
router.get("/products", (req, res) => {
  res.render("pages/product", { title: "Products" });
});

// About page
router.get("/about", (req, res) => {
  res.render("pages/about", { title: "About Us" });
});

// Contact page
router.get("/contact", (req, res) => {
  res.render("pages/contact", { title: "Contact Us" });
});

// Login page
const crypto = require("crypto");
router.get("/login", (req, res) => {
  // double-submit CSRF token: set a cookie and pass it into the rendered form
  const csrfToken = crypto.randomBytes(24).toString("hex");
  const isProd = process.env.NODE_ENV === "production";
  const { question, answer } = generateMathCaptcha();
  res.cookie("XSRF-TOKEN", csrfToken, {
    httpOnly: false,
    secure: isProd,
    sameSite: "Strict",
    path: "/",
  });
  res.render("pages/auth", {
    title: "Authentication",
    csrfToken,
    recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || "",
    error: null,
    registered: req.query.registered || null,
    layout: "layouts/auth",
    mathQuestion: question,
    mathAnswer: answer,
    active: "sign-in",
    extraStyles: ["/css/auth/auth.css"],
    extraScripts: [
      "/js/auth-panel.js",
      "/js/auth-common.js",
      "/js/login.js",
      "/js/register.js",
    ],
  });
});

// Register page (customers only) -> render combined auth panel, prefer sign-up
router.get("/register", (req, res) => {
  const csrfToken = crypto.randomBytes(24).toString("hex");
  const isProd = process.env.NODE_ENV === "production";
  const { question, answer } = generateMathCaptcha();
  res.cookie("XSRF-TOKEN", csrfToken, {
    httpOnly: false,
    secure: isProd,
    sameSite: "Strict",
    path: "/",
  });
  res.render("pages/auth", {
    title: "Create an Account",
    csrfToken,
    recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || "",
    layout: "layouts/auth",
    mathQuestion: question,
    mathAnswer: answer,
    active: "sign-up",
    extraStyles: ["/css/auth/auth.css"],
    extraScripts: [
      "/js/auth-panel.js",
      "/js/auth-common.js",
      "/js/register.js",
    ],
  });
});

// Forgot password page
router.get("/forgot-password", (req, res) => {
  const csrfToken = crypto.randomBytes(24).toString("hex");
  const isProd = process.env.NODE_ENV === "production";
  res.cookie("XSRF-TOKEN", csrfToken, {
    httpOnly: false,
    secure: isProd,
    sameSite: "Strict",
    path: "/",
  });
  const { question, answer } = generateMathCaptcha();
  res.render("pages/forgot-password", {
    title: "Forgot your password",
    csrfToken,
    layout: "layouts/auth",
    extraScripts: ["/js/auth-common.js", "/js/forgot.js"],
    mathQuestion: question,
    mathAnswer: answer,
    recaptchaSiteKey: "",
  });
});

// Reset password (token in query)
router.get("/reset-password", (req, res) => {
  const csrfToken = crypto.randomBytes(24).toString("hex");
  const isProd = process.env.NODE_ENV === "production";
  res.cookie("XSRF-TOKEN", csrfToken, {
    httpOnly: false,
    secure: isProd,
    sameSite: "Strict",
    path: "/",
  });
  const { question, answer } = generateMathCaptcha();
  res.render("pages/reset-password", {
    title: "Reset your password",
    csrfToken,
    token: req.query.token || "",
    layout: "layouts/auth",
    extraScripts: ["/js/reset.js"],
    mathQuestion: question,
    mathAnswer: answer,
    // no reCAPTCHA on reset page
    recaptchaSiteKey: "",
  });
});

// Access denied
router.get("/access-denied", (req, res) => {
  res.status(403).render("pages/access-denied", { title: "Access Denied" });
});

// Profile (authenticated users)
router.get("/profile", pageAuth.requireLogin, (req, res) => {
  // If an admin visits the generic profile route, forward them to the admin profile page
  if (req.user && req.user.role === "admin")
    return res.redirect("/profile-admin");
  // likewise, secretary users should see their specialized profile
  if (req.user && req.user.role === "secretary")
    return res.redirect("/secretary/profile");

  res.render("pages/profile", { title: "My Profile" });
});

// User -> reuse profile view (shows login prompt when not authenticated)
router.get("/user", (req, res) => {
  // prevent caching so back/forward can't resurrect an authenticated view
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.render("pages/profile", { title: "My Profile" });
});

// Admin-only profile (separate view)
router.get("/profile-admin", pageAuth.requireRole("admin"), (req, res) => {
  res.render("pages/admin/profile-admin", {
    title: "Admin Profile",
    layout: "layouts/admin",
  });
});

// Backwards-compatible admin path
router.get("/admin/profile", pageAuth.requireRole("admin"), (req, res) => {
  res.render("pages/admin/profile-admin", {
    title: "Admin Profile",
    layout: "layouts/admin",
  });
});

// Book History (customers only)
router.get("/book-history", pageAuth.requireRole("customer"), (req, res) => {
  res.render("pages/book-history", { title: "Booking History" });
});

// ── PayMongo GCash redirect landing pages ────────────────────────────────────
// PayMongo redirects the customer here after GCash payment completes or fails.
router.get("/payment/success", (req, res) => {
  const { ref, method } = req.query;
  res.render("pages/payment-success", {
    title:         "Payment Successful",
    bookingRef:    ref   || "",
    paymentMethod: method || "gcash",
    layout:        "main",
  });
});

router.get("/payment/failed", (req, res) => {
  const { ref, method } = req.query;
  res.render("pages/payment-failed", {
    title:         "Payment Failed",
    bookingRef:    ref   || "",
    paymentMethod: method || "gcash",
    layout:        "main",
  });
});

// Purchase History (customers only)
router.get(
  "/purchase-history",
  pageAuth.requireRole("customer"),
  (req, res) => {
    res.render("pages/purchase-history", { title: "Purchase History" });
  },
);

// Secretary profile (role-specific page) -- similar look/feel to admin profile
router.get(
  "/secretary/profile",
  pageAuth.requireRole("secretary"),
  (req, res) => {
    res.render("pages/secretary/secretary-profile", {
      title: "Secretary Profile",
      layout: "layouts/secretary",
    });
  },
);

// Technician profile (role-specific page) – reuse profile-technician view
router.get(
  "/technician/profile",
  pageAuth.requireRole("technician"),
  (req, res) => {
    res.render("pages/technician/profile-technician", {
      title: "Technician Profile",
      layout: "layouts/technician",
    });
  },
);

// Admin dashboard
router.get("/admin", pageAuth.requireRole("admin"), (req, res) => {
  res.render("pages/admin/admin-dashboard", {
    title: "Admin Dashboard",
    layout: "layouts/admin",
  });
});

// Admin - Appointments
router.get(
  "/admin/appointments",
  pageAuth.requireRole("admin"),
  async (req, res) => {
    // fetch a batch of bookings server-side so the view can render immediately
    try {
      const BookingService = require("../models/BookingService");
      // only include confirmed (future) appointments in the initial batch;
      // pending booking requests are shown in the requests tab instead.
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const bookings = await BookingService.find({
        status: "confirmed",
        bookingDate: { $gte: today },
      })
        .sort({ bookingDate: 1, startTime: 1 })
        .limit(200)
        .populate("serviceId")
        // try populating technicianId so its name can be used if available
        .populate("technicianId")
        .lean();
      // normalize a convenient `service` string for the template/JS
      bookings.forEach((b) => {
        // normalise convenience field; fall back to generic serviceType
        if (b.serviceId && (b.serviceId.name || b.serviceId.title)) {
          b.service = b.serviceId.name || b.serviceId.title;
        } else if (!b.service) {
          b.service = b.serviceType || "";
        }
        // ensure we have a technician name for the front-end
        if (!b.technicianName) {
          if (b.technician && b.technician.name) {
            b.technicianName = b.technician.name;
          } else if (b.technicianId) {
            // may be populated or just an id; attempt to infer from populated object
            if (typeof b.technicianId === "object") {
              b.technicianName =
                b.technicianId.name || b.technicianId.fullName ||
                ((b.technicianId.firstName || "") + " " + (b.technicianId.lastName || "")).trim();
            }
          }
        }
      });
      res.render("pages/admin/Appointments/Appointments", {
        title: "Appointments",
        layout: "layouts/admin",
        initialBookings: bookings,
      });
    } catch (err) {
      console.error("/admin/appointments failed", err && err.message);
      res.render("pages/admin/Appointments/Appointments", {
        title: "Appointments",
        layout: "layouts/admin",
        initialBookings: [],
      });
    }
  },
);
router.get(
  "/admin/appointments/overview",
  pageAuth.requireRole("admin"),
  (req, res) => {
    res.render("pages/admin/Appointments/Overview", {
      title: "Appointments Overview",
      layout: "layouts/admin",
    });
  },
);
router.get(
  "/admin/appointments/calendar",
  pageAuth.requireRole("admin"),
  (req, res) => {
    res.render("pages/admin/Appointments/Calendar", {
      title: "Appointments Calendar",
      layout: "layouts/admin",
    });
  },
);
router.get(
  "/admin/appointments/booking-requests",
  pageAuth.requireRole("admin"),
  (req, res) => {
    res.render("pages/admin/Appointments/BookingRequest", {
      title: "Booking Requests",
      layout: "layouts/admin",
    });
  },
);
router.get(
  "/admin/appointments/reschedule",
  pageAuth.requireRole("admin"),
  (req, res) => {
    res.render("pages/admin/Appointments/Reschedule", {
      title: "Reschedule Appointment",
      layout: "layouts/admin",
    });
  },
);

// Admin - Jobs
router.get("/admin/jobs/active", pageAuth.requireRole("admin"), (req, res) => {
  res.render("pages/admin/Jobs/ActiveJobs", {
    title: "Active Jobs",
    layout: "layouts/admin",
  });
});
router.get(
  "/admin/jobs/completed",
  pageAuth.requireRole("admin"),
  (req, res) => {
    res.render("pages/admin/Jobs/CompletedJobs", {
      title: "Completed Jobs",
      layout: "layouts/admin",
    });
  },
);

// Admin - Inventory
router.get("/admin/inventory", pageAuth.requireRole("admin"), (req, res) => {
  res.render("pages/admin/Inventory/InventoryList", {
    title: "Inventory",
    layout: "layouts/admin",
  });
});
router.get(
  "/admin/inventory/list",
  pageAuth.requireRole("admin"),
  (req, res) => {
    res.render("pages/admin/Inventory/InventoryList", {
      title: "Inventory List",
      layout: "layouts/admin",
    });
  },
);
router.get(
  "/admin/inventory/history",
  pageAuth.requireRole("admin"),
  (req, res) => {
    res.render("pages/admin/Inventory/StockHistory", {
      title: "Stock History",
      layout: "layouts/admin",
    });
  },
);

// Admin - Customers
router.get(
  "/admin/customers/list",
  pageAuth.requireRole("admin"),
  (req, res) => {
    res.render("pages/admin/Customers/CustomerList", {
      title: "Customer List",
      layout: "layouts/admin",
    });
  },
);
router.get(
  "/admin/customers/privileges",
  pageAuth.requireRole("admin"),
  (req, res) => {
    res.render("pages/admin/Customers/Privilege", {
      title: "Customer Privileges",
      layout: "layouts/admin",
    });
  },
);

// Admin - Staff
router.get("/admin/staff/list", pageAuth.requireRole("admin"), (req, res) => {
  res.render("pages/admin/Staff/StaffList", {
    title: "Staff List",
    layout: "layouts/admin",
  });
});

// Admin - Payments (scaffolded placeholders)
router.get("/admin/payments", pageAuth.requireRole("admin"), (req, res) => {
  res.render("pages/admin/Payments/PaymentsList", {
    title: "Payments",
    layout: "layouts/admin",
  });
});
router.get(
  "/admin/payments/pending",
  pageAuth.requireRole("admin"),
  (req, res) => {
    res.render("pages/admin/Payments/PendingPayments", {
      title: "Pending Payments",
      layout: "layouts/admin",
    });
  },
);
router.get(
  "/admin/payments/completed",
  pageAuth.requireRole("admin"),
  (req, res) => {
    res.render("pages/admin/Payments/CompletedPayments", {
      title: "Completed Payments",
      layout: "layouts/admin",
    });
  },
);

// Admin - Services (scaffolded placeholders)
router.get(
  "/admin/services/core",
  pageAuth.requireRole("admin"),
  async (req, res) => {
    try {
      const coreServices = await CoreService.find({}).lean().limit(200);
      // optionally count bookings per service for dashboard stats
      const BookingService = require("../models/BookingService");
      const counts = await BookingService.aggregate([
        { $match: { serviceId: { $in: coreServices.map((s) => s._id) } } },
        { $group: { _id: "$serviceId", count: { $sum: 1 } } },
      ]);
      const countMap = counts.reduce((m, c) => {
        m[c._id.toString()] = c.count;
        return m;
      }, {});
      coreServices.forEach((s) => {
        s.bookingCount = countMap[s._id.toString()] || 0;
      });

      res.render("pages/admin/Services/CoreServices", {
        title: "Core Services",
        layout: "layouts/admin",
        coreServices,
      });
    } catch (err) {
      console.error("/admin/services/core failed", err && err.message);
      res.render("pages/admin/Services/CoreServices", {
        title: "Core Services",
        layout: "layouts/admin",
        coreServices: [],
      });
    }
  },
);
router.get(
  "/admin/services/repair",
  pageAuth.requireRole("admin"),
  async (req, res) => {
    try {
      const repairServices = await RepairService.find({}).lean().limit(200);
      // count bookings for repair services as well
      const BookingService = require("../models/BookingService");
      const counts = await BookingService.aggregate([
        { $match: { serviceId: { $in: repairServices.map((s) => s._id) } } },
        { $group: { _id: "$serviceId", count: { $sum: 1 } } },
      ]);
      const countMap = counts.reduce((m, c) => {
        m[c._id.toString()] = c.count;
        return m;
      }, {});
      repairServices.forEach((s) => {
        s.bookingCount = countMap[s._id.toString()] || 0;
      });

      res.render("pages/admin/Services/RepairServices", {
        title: "Repair Services",
        layout: "layouts/admin",
        repairServices,
      });
    } catch (err) {
      console.error("/admin/services/repair failed", err && err.message);
      res.render("pages/admin/Services/RepairServices", {
        title: "Repair Services",
        layout: "layouts/admin",
        repairServices: [],
      });
    }
  },
);

// Admin - Technicians (scaffolded placeholders)
router.get("/admin/technicians", pageAuth.requireRole("admin"), (req, res) => {
  res.render("pages/admin/Technicians/TechnicianList", {
    title: "Technicians",
    layout: "layouts/admin",
  });
});

// technician pages
// dashboard entry point
router.get(
  "/technician",
  pageAuth.requireRole("technician"),
  async (req, res, next) => {
    try {
      const Technician = require("../models/Technician");
      const tech = await Technician.findOne({ user: req.user._id }).lean();
      res.render("pages/technician/techniciandashboard", {
        title: "Technician Dashboard",
        layout: "layouts/technician",
        technician: tech || {},
      });
    } catch (e) {
      next(e);
    }
  },
);

// personal schedule view (secondary page)
router.get(
  "/technician/schedule",
  pageAuth.requireRole("technician"),
  async (req, res, next) => {
    try {
      const Technician = require("../models/Technician");
      const BookingService = require("../models/BookingService");
      const tech = await Technician.findOne({ user: req.user._id }).lean();

      let appointments = [];
      if (tech && tech._id) {
        const technicianIds = [String(tech._id)];
        if (tech.user) technicianIds.push(String(tech.user));
        if (req.user && req.user._id) technicianIds.push(String(req.user._id));

        const since = new Date();
        since.setDate(since.getDate() - 30);
        since.setHours(0, 0, 0, 0);

        appointments = await BookingService.find({
          technicianId: { $in: Array.from(new Set(technicianIds)) },
          bookingDate: { $gte: since },
        })
          .sort({ bookingDate: 1, startTime: 1 })
          .limit(500)
          .lean();
      }

      res.render("pages/technician/technicianschedule", {
        title: "Technician Schedule",
        layout: "layouts/technician",
        technician: tech || {},
        initialAppointments: appointments,
      });
    } catch (e) {
      next(e);
    }
  },
);

// simple tracker page that technicians can open from their device to update
// their location automatically (uses browser geolocation API)
router.get(
  "/technician/tracker",
  pageAuth.requireRole("technician"),
  (req, res) => {
    res.render("pages/technician/tracker", {
      title: "Location Tracker",
      layout: "layouts/technician",
    });
  },
);
router.get(
  "/admin/technicians/schedules",
  pageAuth.requireRole("admin"),
  (req, res) => {
    res.render("pages/admin/Technicians/Schedules", {
      title: "Technician Schedules",
      layout: "layouts/admin",
    });
  },
);
router.get(
  "/admin/technicians/skills",
  pageAuth.requireRole("admin"),
  (req, res) => {
    res.render("pages/admin/Technicians/Skills", {
      title: "Technician Skills",
      layout: "layouts/admin",
    });
  },
);

// Admin - Notifications & Roles (scaffolded placeholders)
router.get(
  "/admin/notifications",
  pageAuth.requireRole("admin"),
  (req, res) => {
    res.render("pages/admin/Notifications/Notifications", {
      title: "Notifications",
      layout: "layouts/admin",
    });
  },
);
router.get("/admin/roles", pageAuth.requireRole("admin"), (req, res) => {
  res.render("pages/admin/Roles/Roles", {
    title: "Roles & Permissions",
    layout: "layouts/admin",
  });
});

// Admin - Reports
router.get(
  "/admin/reports/service",
  pageAuth.requireRole("admin"),
  (req, res) => {
    res.render("pages/admin/Reports/ServiceReport", {
      title: "Service Reports",
      layout: "layouts/admin",
    });
  },
);
router.get(
  "/admin/reports/inventory",
  pageAuth.requireRole("admin"),
  (req, res) => {
    res.render("pages/admin/Reports/InventoryReports", {
      title: "Inventory Reports",
      layout: "layouts/admin",
    });
  },
);
router.get(
  "/admin/reports/revenue",
  pageAuth.requireRole("admin"),
  (req, res) => {
    res.render("pages/admin/Reports/RevenueReports", {
      title: "Revenue Reports",
      layout: "layouts/admin",
    });
  },
);

// Admin - Settings
// Scheduling UI moved under the Technicians section — keep the old path as a redirect for compatibility
router.get(
  "/admin/settings/scheduling",
  pageAuth.requireRole("admin"),
  (req, res) => {
    return res.redirect(302, "/admin/technicians/scheduling");
  },
);
router.get(
  "/admin/technicians/scheduling",
  pageAuth.requireRole("admin"),
  (req, res) => {
    res.render("pages/admin/Technicians/Scheduling", {
      title: "Scheduling Settings",
      layout: "layouts/admin",
    });
  },
);
router.get(
  "/admin/settings/system",
  pageAuth.requireRole("admin"),
  (req, res) => {
    res.render("pages/admin/Settings/System", {
      title: "System settings",
      layout: "layouts/admin",
    });
  },
);
router.get(
  "/admin/settings/email",
  pageAuth.requireRole("admin"),
  (req, res) => {
    res.render("pages/admin/Settings/Email", {
      title: "Email / SMTP",
      layout: "layouts/admin",
    });
  },
);

// Admin - Logs page
router.get("/admin/logs", pageAuth.requireRole("admin"), (req, res) => {
  res.render("pages/admin/logs", {
    title: "System Logs",
    layout: "layouts/admin",
  });
});

// Secretary dashboard
router.get("/secretary", pageAuth.requireRole("secretary"), (req, res) => {
  // Use dedicated layout so CSS is loaded only when needed
  res.render("pages/secretary/secretary-dashboard", {
    title: "Secretary Dashboard",
    layout: "layouts/secretary",
  });
});

// Secretary overview
router.get(
  "/secretary/overview",
  pageAuth.requireRole("secretary"),
  (req, res) => {
    // views moved into Appointments folder
    res.render("pages/secretary/Appointments/Overview", {
      title: "Overview",
      layout: "layouts/secretary",
    });
  },
);

// Secretary appointments
router.get(
  "/secretary/appointments",
  pageAuth.requireRole("secretary"),
  (req, res) => {
    res.render("pages/secretary/Appointments/Appointments", {
      title: "Appointments",
      layout: "layouts/secretary",
    });
  },
);

// Secretary calendar
router.get(
  "/secretary/calendar",
  pageAuth.requireRole("secretary"),
  (req, res) => {
    res.render("pages/secretary/Appointments/Calendar", {
      title: "Calendar",
      layout: "layouts/secretary",
    });
  },
);

// Secretary point of sale
router.get(
  "/secretary/pointofsale",
  pageAuth.requireRole("secretary"),
  (req, res) => {
    res.render("pages/secretary/Appointments/Pointofsale", {
      title: "Point of Sale",
      layout: "layouts/secretary",
    });
  },
);

// Secretary services (added for dropdown)
router.get(
  "/secretary/services/core",
  pageAuth.requireRole("secretary"),
  async (req, res) => {
    try {
      const coreServices = await CoreService.find({}).lean().limit(200);
      res.render("pages/secretary/Services/Coreservices", {
        title: "Core Services",
        layout: "layouts/secretary",
        coreServices,
      });
    } catch (err) {
      console.error("/secretary/services/core failed", err && err.message);
      res.render("pages/secretary/Services/Coreservices", {
        title: "Core Services",
        layout: "layouts/secretary",
        coreServices: [],
      });
    }
  },
);
router.get(
  "/secretary/services/repair",
  pageAuth.requireRole("secretary"),
  async (req, res) => {
    try {
      const repairServices = await RepairService.find({}).lean().limit(200);
      res.render("pages/secretary/Services/Repairservices", {
        title: "Repair Services",
        layout: "layouts/secretary",
        repairServices,
      });
    } catch (err) {
      console.error("/secretary/services/repair failed", err && err.message);
      res.render("pages/secretary/Services/Repairservices", {
        title: "Repair Services",
        layout: "layouts/secretary",
        repairServices: [],
      });
    }
  },
);

// EXPORT router
module.exports = router;

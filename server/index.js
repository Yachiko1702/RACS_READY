const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const path = require("path");
const expressEjsLayouts = require("express-ejs-layouts");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const attachCurrentUser = require("./middleware/currentUser");
const User = require("./models/User");
const AuthSession = require("./models/AuthSession");

dotenv.config();

const app = express();

// Database connection
mongoose
  .connect(
    process.env.MONGODB_URI ||
      "mongodb://localhost:27017/appointment_scheduler",
  )
  .then(() => console.log("MongoDB connected successfully"))
  .catch((err) => {
    console.error("MongoDB connection error:", err.message);
    process.exit(1);
  });

// Views Engine Setup
app.use(expressEjsLayouts);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("layout", "layouts/main");

// Helmet Security Middleware - disable default CSP so we can set our own
app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);

// Hide server information
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.removeHeader("Server");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

// Content Security Policy - allow CDN resources used by the site
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; " +
      // allow leaflet from unpkg if any page still references it, and other CDNs
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://maps.googleapis.com https://maps.gstatic.com https://www.google.com https://www.gstatic.com https://www.recaptcha.net; " +
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://fonts.googleapis.com https://maps.googleapis.com https://maps.gstatic.com; " +
      "img-src 'self' data: https://cdn.jsdelivr.net https://maps.googleapis.com https://maps.gstatic.com https://www.google.com https://www.gstatic.com https://www.recaptcha.net https://a.tile.openstreetmap.org https://b.tile.openstreetmap.org https://c.tile.openstreetmap.org https://api.qrserver.com; " +
      "connect-src 'self' https://cdn.jsdelivr.net https://maps.googleapis.com https://maps.gstatic.com https://www.google.com https://www.gstatic.com https://www.recaptcha.net https://psgc.cloud https://a.tile.openstreetmap.org https://b.tile.openstreetmap.org https://c.tile.openstreetmap.org https://nominatim.openstreetmap.org https://api.qrserver.com; " +
      "font-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.jsdelivr.net; " +
      "frame-src 'self' https://www.google.com https://www.gstatic.com https://www.recaptcha.net;",
  );
  next();
});

app.use(cors());
// increase payload limit to accommodate base64-encoded proof images
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// express-session (server-side sessions)
const session = require("express-session");
const MongoStore = require("connect-mongo");
const SESSION_TTL = Number(process.env.SESSION_TTL_MS) || 30 * 60 * 1000; // ms
const SESSION_SECRET =
  process.env.SESSION_SECRET || process.env.JWT_SECRET || "dev-session-secret";

// create a named session store so we can clear it in development on startup
const sessionStore = MongoStore.create({
  mongoUrl:
    process.env.MONGODB_URI ||
    "mongodb://localhost:27017/appointment_scheduler",
  ttl: Math.floor(SESSION_TTL / 1000),
});

app.use(
  session({
    name: "sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: SESSION_TTL,
    },
  }),
);

// Development convenience: clear server-side sessions and invalidate JWT-bound sessionIds
// on server start so restarting the dev server doesn't leave you logged in.
if (process.env.NODE_ENV === "development") {
  (async function clearDevSessions() {
    try {
      if (sessionStore && typeof sessionStore.clear === "function") {
        await new Promise((resolve, reject) =>
          sessionStore.clear((err) => (err ? reject(err) : resolve())),
        );
        // dev: express-session store cleared (log suppressed)
      }
    } catch (e) {
      console.warn(
        "Dev: failed to clear session store on startup:",
        e && e.message,
      );
    }

    try {
      await User.updateMany({}, { $unset: { currentSessionId: 1 } });
      await AuthSession.updateMany({}, { $set: { revoked: true } });
      // dev: user session ids invalidated and auth sessions revoked (log suppressed)
    } catch (e) {
      console.warn(
        "Dev: failed to clear user session ids on startup:",
        e && e.message,
      );
    }
  })();
}

// Attach the current user to templates/res.locals when possible (non-blocking)
app.use(attachCurrentUser);

// Prevent NoSQL injection by sanitizing any keys containing '$' or '.' from request data
const mongoSanitize = require("express-mongo-sanitize");
// Use in-place sanitization to avoid reassigning req.query (which can be a getter-only property in some environments)
app.use(function (req, res, next) {
  try {
    if (req.body && typeof req.body === "object")
      mongoSanitize.sanitize(req.body);
    if (req.params && typeof req.params === "object")
      mongoSanitize.sanitize(req.params);
    if (req.headers && typeof req.headers === "object")
      mongoSanitize.sanitize(req.headers);
    if (req.query && typeof req.query === "object")
      mongoSanitize.sanitize(req.query);
  } catch (err) {
    // don't break request flow for sanitization errors
    console.warn("mongo-sanitize failed:", err && err.message);
  }
  next();
});

app.use(express.static(path.join(__dirname, "public")));

// Routes
const pageRoutes = require("./routes/pages");
app.use("/", pageRoutes);

// API routes
const productRoutes = require("./routes/productRoutes");
app.use("/api/products", productRoutes);

const serviceRoutes = require("./routes/serviceRoutes");
app.use("/api/services", serviceRoutes);

const appointmentRoutes = require("./routes/appointmentRoutes");
console.log("[startup] appointmentRoutes type", typeof appointmentRoutes);
if (appointmentRoutes && typeof appointmentRoutes === "function") {
  app.use("/api/appointments", appointmentRoutes);
  // Mount the same routes at /appointments so client-side code that posts to /appointments
  // (UI) is protected by the same server-side authentication checks.
  app.use("/appointments", appointmentRoutes);
} else {
  console.warn(
    "Appointment routes could not be mounted (not a function):",
    appointmentRoutes,
  );
}

const userRoutes = require("./routes/userRoutes");
app.use("/api/users", userRoutes);

const authRoutes = require("./routes/authRoutes");
app.use("/api/auth", authRoutes);

const adminApi = require("./routes/adminApi");
app.use("/api/admin", adminApi);

const inventoryRoutes = require("./routes/inventoryRoutes");
app.use("/api/inventory", inventoryRoutes);

const psgcRoutes = require("./routes/psgcRoutes");
app.use("/api/psgc", psgcRoutes);

// Secretary‑specific APIs (currently just analytics). Mounted separately so we
// can apply the "secretary" role check without exposing the entire admin
// namespace.
const secretaryApi = require("./routes/secretaryApi");
app.use("/api/secretary", secretaryApi);

// Public holidays (supports multiple providers: google or nager)
const holidayRoutes = require("./routes/holidayRoutes");
app.use("/api/holidays", holidayRoutes);

// PayMongo webhook (public)
const paymongoRoutes = require("./routes/paymongoRoutes");
app.use("/api/paymongo", paymongoRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log("✓ Server is running");
  console.log(`→ http://localhost:${PORT}`);
});

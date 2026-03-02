const express = require("express");
const router = express.Router();
const { body } = require("express-validator");
const authController = require("../controllers/authController");
// secure (session) auth - optional new implementation
const secureAuthRoutes = require("./secureAuth");

// Register - basic customer registration
router.post(
  "/register",
  [
    body("email")
      .isLength({ max: 50 })
      .withMessage("Invalid input")
      .trim()
      .matches(/^[A-Za-z0-9]+@[A-Za-z0-9]+\.[A-Za-z0-9]+$/)
      .withMessage("Invalid email format"),
    body("password")
      .isLength({ min: 8, max: 12 })
      .withMessage("Invalid input")
      .matches(/^[A-Za-z0-9]+$/)
      .withMessage("Password must be alphanumeric"),
    body("mathCaptcha")
      .matches(/^\d+$/)
      .isLength({ min: 1, max: 2 })
      .withMessage("Invalid captcha")
      .trim(),
    body("mathAnswer")
      .matches(/^\d+$/)
      .isLength({ min: 1, max: 2 })
      .withMessage("Invalid captcha answer")
      .trim(),
    // Profile fields required for customers
    body("firstName")
      .isLength({ min: 1, max: 8 })
      .withMessage("Invalid first name")
      .matches(/^[A-Za-z\s]+$/)
      .withMessage("First name must contain letters only")
      .trim(),
    body("lastName")
      .isLength({ min: 1, max: 8 })
      .withMessage("Invalid last name")
      .matches(/^[A-Za-z\s]+$/)
      .withMessage("Last name must contain letters only")
      .trim(),
    body("phone")
      .matches(/^(?:0\d{10}|63\d{10}|9\d{9})$/)
      .withMessage("Invalid Philippine mobile number")
      .trim(),
    body("addressProvince")
      .isLength({ min: 1, max: 100 })
      .withMessage("Invalid province")
      .trim(),
    body("addressCity")
      .isLength({ min: 1, max: 100 })
      .withMessage("Invalid city")
      .trim(),
    body("addressBarangay")
      .optional()
      .isLength({ min: 1, max: 100 })
      .withMessage("Invalid barangay")
      .trim(),
    body("addressPostal")
      .matches(/^[0-9]{1,4}$/)
      .withMessage("Postal code must be 1 to 4 digits")
      .trim(),
  ],
  authController.register,
);

// Login - CSRF double submit expected (csrfToken) and generic errors
router.post(
  "/login",
  [
    body("email")
      .isLength({ max: 50 })
      .withMessage("Invalid input")
      .trim()
      .matches(/^[A-Za-z0-9]+@[A-Za-z0-9]+\.[A-Za-z0-9]+$/)
      .withMessage("Invalid email format"),
    body("password")
      .isLength({ min: 8, max: 12 })
      .withMessage("Invalid input")
      .matches(/^[A-Za-z0-9]+$/)
      .withMessage("Password must be alphanumeric"),
    body("mathCaptcha")
      .matches(/^\d+$/)
      .isLength({ min: 1, max: 2 })
      .withMessage("Invalid input")
      .trim(),
    body("mathAnswer")
      .matches(/^\d+$/)
      .isLength({ min: 1, max: 2 })
      .withMessage("Invalid input")
      .trim(),
    body("csrfToken").isString().withMessage("Invalid input"),
  ],
  authController.login,
);

// Verify login OTP (used when an OTP was requested during initial login)
router.post(
  "/verify-login-otp",
  [
    body("email")
      .isLength({ max: 50 })
      .withMessage("Invalid input")
      .trim()
      .matches(/^[A-Za-z0-9]+@[A-Za-z0-9]+\.[A-Za-z0-9]+$/)
      .withMessage("Invalid email format"),
    body("otp")
      .isNumeric()
      .isLength({ min: 6, max: 6 })
      .withMessage("Invalid OTP")
      .trim(),
  ],
  authController.verifyLoginOTP,
);

// Resend login OTP
router.post(
  "/resend-login-otp",
  [
    body("email")
      .isLength({ max: 50 })
      .withMessage("Invalid input")
      .trim()
      .matches(/^[A-Za-z0-9]+@[A-Za-z0-9]+\.[A-Za-z0-9]+$/)
      .withMessage("Invalid email format"),
  ],
  authController.resendLoginOTP,
);

// Forgot password (generic response)
router.post(
  "/forgot-password",
  [
    body("email")
      .isLength({ max: 50 })
      .withMessage("Invalid input")
      .trim()
      .matches(/^[A-Za-z0-9]+@[A-Za-z0-9]+\.[A-Za-z0-9]+$/)
      .withMessage("Invalid email format"),
    body("csrfToken").optional().isString().withMessage("Invalid input"),
  ],
  authController.forgotPassword,
);

// Reset password
router.post(
  "/reset-password",
  [
    body("token")
      .isString()
      .isLength({ min: 10, max: 256 })
      .withMessage("Invalid input"),
    body("password").isLength({ min: 8, max: 12 }).withMessage("Invalid input"),
    body("csrfToken").isString().withMessage("Invalid input"),
  ],
  authController.resetPassword,
);

// Logout
router.post("/logout", authController.logout);

// technician location update (device reports its coordinates)
router.post(
  "/technician/location",
  require("../middleware/authenticate").authenticate,
  async (req, res) => {
    try {
      const user = req.user;
      if (!user || user.role !== "technician")
        return res.status(403).json({ error: "forbidden" });
      // Accept lat/lng in request body; caller (tracker page) sends {lat, lng}
      const { lat, lng } = req.body || {};
      if (
        typeof lng !== "number" ||
        typeof lat !== "number" ||
        Number.isNaN(lng) ||
        Number.isNaN(lat)
      ) {
        return res.status(400).json({ error: "invalid_coordinates" });
      }
      const Technician = require("../models/Technician");
      const tech = await Technician.findOneAndUpdate(
        { user: user._id },
        // GeoJSON order is [lng, lat]
        { location: { type: "Point", coordinates: [lng, lat] } },
        { new: true },
      );
      if (!tech) return res.status(404).json({ error: "technician_not_found" });
      return res.json({ location: tech.location });
    } catch (err) {
      console.error("technician location update error", err);
      return res.status(500).json({ error: "server_error" });
    }
  },
);

// Verify token
router.get("/verify", authController.verify);

// Mount secure session-based endpoints (optional, non-breaking)
router.use("/secure", secureAuthRoutes);

module.exports = router;

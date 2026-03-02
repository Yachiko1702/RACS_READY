const express = require("express");
const router = express.Router();
const admin = require("../controllers/adminController");
const auth = require("../middleware/authenticate");

// only authenticated secretaries should be able to hit these endpoints
router.use(auth.authenticate);
router.use(auth.requireRole("secretary"));

// for now we only need the analytics summary; reuse admin controller logic
router.get("/analytics/summary", admin.analyticsSummary);

module.exports = router;

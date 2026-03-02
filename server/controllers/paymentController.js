const mongoose = require("mongoose");
const Payment = require("../models/Payment");
const BookingService = require("../models/BookingService");
const audit = require("../utils/audit");

// helper to log audit events for payments
async function logPaymentAction(actorId, paymentId, action, req, details) {
  try {
    await audit.logEvent({
      actor: actorId,
      target: paymentId,
      action,
      module: "payment",
      req,
      details,
    });
  } catch (e) {
    console.warn("Payment audit error", e && e.message);
  }
}

// validate ObjectId
function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// create a new payment record and optionally update booking
exports.createPayment = async (req, res, next) => {
  try {
    const {
      bookingId,
      amount,
      method,
      type = "final",
      reference,
      proofUrl,
      notes,
    } = req.body;

    if (!bookingId || !isValidId(bookingId))
      return res.status(400).json({ error: "bookingId is required" });
    if (amount == null || isNaN(Number(amount)) || Number(amount) <= 0)
      return res.status(400).json({ error: "Valid amount is required" });
    if (!method || !["gcash", "cod", "bank", "paymongo", "other"].includes(method))
      return res.status(400).json({ error: "Invalid payment method" });
    if (!["downpayment", "final", "adjustment"].includes(type))
      return res.status(400).json({ error: "Invalid payment type" });

    const booking = await BookingService.findById(bookingId);
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    // for cash method require downpayment to be type 'downpayment'
    if (method === "cod" && type === "downpayment") {
      // record on booking as well
      booking.downpaymentAmount = amount;
    }

    const payment = new Payment({
      bookingId,
      amount,
      method,
      type,
      reference,
      proofUrl,
      notes,
    });

    await Promise.all([payment.save(), booking.save()]);

    await logPaymentAction(req.user._id, payment._id, "create", req, {
      bookingId,
      method,
      amount,
      type,
    });

    res.json({ payment });
  } catch (err) {
    next(err);
  }
};

// list payments with optional filters (bookingId, status, method, type)
exports.listPayments = async (req, res, next) => {
  try {
    const q = {};
    if (req.query.bookingId && isValidId(req.query.bookingId)) {
      q.bookingId = req.query.bookingId;
    }
    if (req.query.status) q.status = req.query.status;
    if (req.query.method) q.method = req.query.method;
    if (req.query.gateway) q.gateway = req.query.gateway;
    if (req.query.gatewayStatus) q.gatewayStatus = req.query.gatewayStatus;
    if (req.query.type) q.type = req.query.type;
    if (req.query.startDate || req.query.endDate) {
      q.submittedAt = {};
      if (req.query.startDate) q.submittedAt.$gte = new Date(req.query.startDate);
      if (req.query.endDate) q.submittedAt.$lte = new Date(req.query.endDate);
    }

    const payments = await Payment.find(q)
      .sort({ submittedAt: -1 })
      .limit(1000)
      .lean();

    res.json({ payments });
  } catch (err) {
    next(err);
  }
};

// update a payment status/fields
exports.updatePayment = async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid id" });
    const payment = await Payment.findById(id);
    if (!payment) return res.status(404).json({ error: "Payment not found" });

    const allowed = ["status", "verifiedAt", "completedAt", "notes", "amount", "reference", "proofUrl", "gatewayStatus"];
    allowed.forEach((f) => {
      if (req.body[f] !== undefined) payment[f] = req.body[f];
    });
    if (req.body.status && req.body.status === "verified") {
      payment.verifiedAt = new Date();
    }
    if (req.body.status && req.body.status === "completed") {
      payment.completedAt = new Date();
    }

    await payment.save();
    await logPaymentAction(req.user._id, payment._id, "update", req, {
      updates: req.body,
    });
    res.json({ payment });
  } catch (err) {
    next(err);
  }
};

// optional: get payment by id
exports.getPayment = async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid id" });
    const payment = await Payment.findById(id);
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    res.json({ payment });
  } catch (err) {
    next(err);
  }
};

// -------------------------------------------------------------
// PayMongo webhook handler
exports.handleGatewayWebhook = async (evt) => {
  // evt follows PayMongo event format
  try {
    const data = evt.data;
    if (!data || !data.id) return;
    // find payment by gatewayId
    const payment = await Payment.findOne({ gatewayId: data.id });
    if (!payment) return;

    // store raw event for audit
    payment.webhookEvents = payment.webhookEvents || [];
    payment.webhookEvents.push(evt);
    payment.gatewayStatus = data.status;

    switch (evt.type) {
      case "payment_intent.succeeded":
        payment.status = "verified";
        payment.verifiedAt = new Date();
        break;
      case "payment_intent.payment_failed":
        payment.status = "failed";
        break;
      case "payment_intent.processing":
        // leave pending but update status
        break;
      // add other transitions as needed
    }
    await payment.save();
  } catch (e) {
    console.warn("gateway webhook handler error", e.message);
  }
};

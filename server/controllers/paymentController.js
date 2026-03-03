const mongoose = require("mongoose");
const Payment = require("../models/Payment");
const BookingService = require("../models/BookingService");
const audit = require("../utils/audit");
const paymongo = require("../utils/paymongo");

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

// convert minutes to 12‑hour label (used by mailer formatting)
function minutesTo12h(m) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${String(h12).padStart(2, "0")}:${String(min).padStart(2, "0")} ${ampm}`;
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

    const shouldSyncGateway = ["1", "true", "yes"].includes(
      String(req.query.syncGateway || "").toLowerCase(),
    );

    const docs = await Payment.find(q)
      .sort({ submittedAt: -1 })
      .limit(1000);

    if (shouldSyncGateway) {
      for (const payment of docs) {
        try {
          const isPaymongoCandidate =
            payment.gateway === "paymongo" ||
            payment.method === "gcash" ||
            (typeof payment.gatewayId === "string" && payment.gatewayId.length > 0);
          if (!isPaymongoCandidate || !payment.gatewayId) continue;

          let remoteStatus = "";
          if (String(payment.gatewayId).startsWith("src_")) {
            const src = await paymongo.getSource(String(payment.gatewayId));
            remoteStatus = src?.attributes?.status || "";
          } else if (String(payment.gatewayId).startsWith("pay_")) {
            const p = await paymongo.getPayment(String(payment.gatewayId));
            remoteStatus = p?.attributes?.status || "";
          }

          if (!remoteStatus) continue;

          payment.gateway = "paymongo";
          payment.gatewayStatus = remoteStatus;
          if (["paid", "succeeded"].includes(remoteStatus)) {
            payment.status = "paid";
            if (!payment.completedAt) payment.completedAt = new Date();
          } else if (["failed", "cancelled", "expired"].includes(remoteStatus)) {
            payment.status = "failed";
          } else {
            payment.status = "pending";
          }
          await payment.save();
        } catch (syncErr) {
          console.warn(
            "payment sync with PayMongo failed",
            payment && String(payment._id),
            syncErr && syncErr.message,
          );
        }
      }
    }

    let payments = docs.map((d) => d.toObject());
    // normalize legacy statuses
    payments = payments.map((p) => {
      if (String(p.status || "").toLowerCase() === "completed") {
        p.status = "paid";
      }
      return p;
    });

    const bookingIds = payments
      .map((p) => p.bookingId)
      .filter(Boolean);

    let bookingMap = new Map();
    if (bookingIds.length) {
      const bookings = await BookingService.find({ _id: { $in: bookingIds } })
        .select("_id bookingReference customer customerId paymentMethod paymentStatus")
        .lean();
      bookingMap = new Map(bookings.map((b) => [String(b._id), b]));
    }

    const enriched = payments.map((p) => {
      const booking = bookingMap.get(String(p.bookingId)) || null;
      const customerName =
        booking?.customer?.name ||
        "-";
      const customerEmail =
        booking?.customer?.email ||
        "-";

      return {
        ...p,
        bookingReference: booking?.bookingReference || "-",
        bookingStatus: booking?.status || "-",
        customerName,
        customerEmail,
        bookingPaymentMethod: booking?.paymentMethod || null,
        bookingPaymentStatus: booking?.paymentStatus || null,
      };
    });
    res.json({ payments: enriched });
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

    const allowed = ["status", "paidAt", "verifiedAt", "completedAt", "notes", "amount", "reference", "proofUrl", "gatewayStatus"];
    allowed.forEach((f) => {
      if (req.body[f] !== undefined) payment[f] = req.body[f];
    });
    // map legacy values to new enum
    if (req.body.status) {
      const st = String(req.body.status).toLowerCase();
      if (st === "verified" || st === "completed") {
        payment.status = "paid";
      }
      if (st === "paid") {
        payment.status = "paid";
      }
      if (st === "failed") {
        payment.status = "failed";
      }
      if (st === "pending") {
        payment.status = "pending";
      }
      if (st === "partial") {
        payment.status = "partial";
      }
      if (st === "paid") {
        payment.paidAt = new Date();
      }
    }

    await payment.save();

    // when payment status changes, propagate to related booking
    if (payment.bookingId) {
      try {
        const booking = await BookingService.findById(payment.bookingId);
        if (booking) {
          const prevStatus = booking.status;
          const st = String(payment.status || "").toLowerCase();
          if (["paid", "verified", "completed"].includes(st)) {
            booking.paymentStatus = "paid";
            // if booking still pending, treat this as approval
            if (booking.status === "pending") {
              booking.status = "confirmed";
            }
          } else if (st === "failed") {
            booking.paymentStatus = "failed";
            // cancel the booking when a payment is marked failed
            booking.status = "cancelled";
            // append any failure reason to booking notes
            if (req.body.notes) {
              const reasonText = String(req.body.notes).trim();
              if (reasonText) {
                booking.notes = booking.notes
                  ? booking.notes + "\nPayment failed: " + reasonText
                  : "Payment failed: " + reasonText;
              }
            }
            // send notification email to customer if email exists
            try {
              const mailer = require("../utils/mailer");
              if (booking.customer && booking.customer.email) {
                const subject = `Booking Cancelled – ${booking.bookingReference}`;
                const html = `<p>Dear ${booking.customer.name || "customer"},</p>
<p>Your booking <strong>${booking.bookingReference}</strong> has been cancelled because the payment could not be verified.${
                  req.body.notes ? `<br><br>Reason provided: ${String(req.body.notes).trim()}` : ""
                }</p>
<p>If you believe this is an error or wish to reschedule, please contact us.</p>
<p>Thank you,<br/>CALIDRO RACS Team</p>`;
                await mailer.sendMail({
                  to: booking.customer.email,
                  subject,
                  html,
                });
              }
            } catch (mailErr) {
              console.warn("Failed to send cancellation email", mailErr && mailErr.message);
            }
          } else if (st === "partial") {
            booking.paymentStatus = "partial";
            // if cash/COD booking, treat partial as confirmation
            if (booking.paymentMethod === "cod" || booking.paymentMethod === "cash") {
              booking.status = "confirmed";
            }
          }
          await booking.save();

          // if booking just transitioned from pending to confirmed, send confirmation mail
          if (prevStatus === "pending" && booking.status === "confirmed") {
            try {
              const { sendBookingConfirmationEmail, sendTechnicianNotificationEmail } = require("../utils/mailer");
              let customerEmail = null;
              let customerName = "Valued Customer";
              if (booking.customer && booking.customer.email) {
                customerEmail = booking.customer.email;
                customerName = booking.customer.name || booking.customer.fullName || customerName;
              } else if (booking.customerEmail) {
                customerEmail = booking.customerEmail;
              }
              // prepare shared labels for email
              const bookingReference = booking.bookingReference || String(booking._id);
              const serviceName =
                (booking.service && (booking.service.name || booking.service.title)) ||
                booking.serviceType ||
                "Service";
              const bookingDate = booking.bookingDate || new Date();
              const startMin = parseInt(booking.startTime, 10);
              const duration = Number(booking.serviceDurationMinutes) || 0;
              const travelMins = Number(booking.travelTime) || 0;
              const dateLabel = bookingDate.toLocaleDateString("en-PH", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              });
              const timeLabel =
                !isNaN(startMin) && duration
                  ? `${minutesTo12h(startMin)} – ${minutesTo12h(startMin + duration)}`
                  : booking.startTime || "";
              const totalLabel = travelMins
                ? `${minutesTo12h(startMin)} – ${minutesTo12h(startMin + duration + travelMins)} (incl. ${travelMins}m travel)`
                : timeLabel;
              if (customerEmail) {
                await sendBookingConfirmationEmail({
                  to: customerEmail,
                  customerName,
                  bookingReference,
                  serviceName,
                  dateLabel,
                  timeLabel,
                  totalLabel,
                  paymentMethod: booking.paymentMethod,
                  estimatedFee: booking.estimatedFee,
                  locationAddress: (booking.location && booking.location.address) || "",
                  issueDescription: booking.issueDescription || "",
                  travelMins,
                  serviceDuration: duration,
                  isConfirmed: true,
                }).catch((e) => console.warn("confirmation email failed", e && e.message));
              }
              if (booking.technicianId) {
                try {
                  const Technician = require("../models/Technician");
                  const tech = await Technician.findById(booking.technicianId).lean();
                  const techEmail = tech?.email || tech?.user?.email;
                  const techName = tech?.name || tech?.fullName || "Technician";
                  if (techEmail) {
                    await sendTechnicianNotificationEmail({
                      to: techEmail,
                      technicianName: techName,
                      customerName,
                      bookingReference,
                      serviceName,
                      dateLabel,
                      timeLabel,
                      totalLabel,
                      locationAddress: (booking.location && booking.location.address) || "",
                      issueDescription: booking.issueDescription || "",
                    });
                  }
                } catch (e) {
                  console.warn("technician email (confirm) failed", e && e.message);
                }
              }
            } catch (mailErr) {
              console.warn("payment update mailer error", mailErr && mailErr.message);
            }
          }
        }
      } catch (e) {
        console.warn("Failed to sync booking after payment update", e && e.message);
      }
    }

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
    const payment = await Payment.findById(id).lean();
    if (!payment) return res.status(404).json({ error: "Payment not found" });

    const booking = payment.bookingId
      ? await BookingService.findById(payment.bookingId)
        .select(
          "_id bookingReference bookingDate startTime endTime selectedTimeLabel status paymentMethod paymentStatus gcashNumber paymentReference downpaymentAmount paymentNotes paymentProof estimatedFee travelFare travelTime issueDescription location customer technician service servicePrice serviceDurationMinutes createdAt",
        )
        .lean()
      : null;

    // ensure legacy statuses are converted for client
    if (String(payment.status || "").toLowerCase() === "completed") {
      payment.status = "paid";
    }
    const details = {
      ...payment,
      bookingReference: booking?.bookingReference || "-",
      customerName: booking?.customer?.name || "-",
      customerEmail: booking?.customer?.email || "-",
      customerPhone: booking?.customer?.phone || "-",
      serviceName: booking?.service?.name || "-",
      serviceDescription: booking?.service?.description || "-",
      servicePrice: booking?.servicePrice || booking?.service?.basePrice || 0,
      serviceDurationMinutes: booking?.serviceDurationMinutes || 0,
      issueDescription: booking?.issueDescription || "-",
      locationAddress: booking?.location?.address || "-",
      bookingDate: booking?.bookingDate || null,
      selectedTimeLabel: booking?.selectedTimeLabel || "-",
      bookingStatus: booking?.status || "-",
      bookingPaymentStatus: booking?.paymentStatus || "-",
      bookingPaymentMethod: booking?.paymentMethod || "-",
      gcashNumber: booking?.gcashNumber || payment?.gcashNumber || "-",
      gcashReference: booking?.paymentReference || payment?.reference || "-",
      proofUrl: payment?.proofUrl || booking?.paymentProof || "",
      estimatedFee: booking?.estimatedFee || payment?.amount || 0,
      travelFare: booking?.travelFare || 0,
      travelTime: booking?.travelTime || 0,
      downpaymentAmount: booking?.downpaymentAmount || 0,
      technicianName: booking?.technician?.name || "-",
      technicianPhone: booking?.technician?.phone || "-",
      bookingCreatedAt: booking?.createdAt || null,
      booking,
    };

    res.json({ payment: details });
  } catch (err) {
    next(err);
  }
};

// -------------------------------------------------------------
// PayMongo webhook handler
exports.handleGatewayWebhook = async (evt) => {
  // evt follows PayMongo event format
  try {
    const eventType = evt?.data?.attributes?.type || evt?.type;
    const resource = evt?.data?.attributes?.data || evt?.data;
    const gatewayId = resource?.id;
    const metadata = resource?.attributes?.metadata || {};

    if (!eventType) return;

    const payment = await Payment.findOne({
      $or: [
        ...(gatewayId ? [{ gatewayId }] : []),
        ...(metadata.bookingId ? [{ bookingId: metadata.bookingId }] : []),
      ],
    }).sort({ submittedAt: -1 });

    if (!payment) return;

    payment.webhookEvents = payment.webhookEvents || [];
    payment.webhookEvents.push(evt);

    const gatewayStatus = resource?.attributes?.status || eventType;
    payment.gatewayStatus = gatewayStatus;

    if (eventType === "payment.paid" || gatewayStatus === "paid") {
      // use canonical "paid" value for status (completed is legacy)
      payment.status = "paid";
      payment.completedAt = payment.completedAt || new Date();
      payment.gatewayType = "payment";
      if (gatewayId) payment.gatewayId = gatewayId;
    } else if (eventType === "payment.failed" || gatewayStatus === "failed") {
      payment.status = "failed";
      payment.gatewayType = "payment";
      if (gatewayId) payment.gatewayId = gatewayId;
    } else if (eventType === "source.chargeable") {
      payment.status = "pending";
      payment.gatewayType = "source";
      if (gatewayId) payment.gatewayId = gatewayId;
    }

    await payment.save();
  } catch (e) {
    console.warn("gateway webhook handler error", e.message);
  }
};

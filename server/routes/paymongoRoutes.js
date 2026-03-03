const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/paymentController");
const paymongo = require("../utils/paymongo");
const BookingService = require("../models/BookingService");
const Payment = require("../models/Payment");

// ─── Webhook endpoint (no auth) for PayMongo events ─────────────────────────
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sigHeader = req.headers["paymongo-signature"];
    let evt;
    try {
      evt = paymongo.verifyWebhook(req.body, sigHeader, process.env.PAYMONGO_WEBHOOK_SECRET);
    } catch (err) {
      console.warn("paymongo webhook signature error", err.message);
      return res.status(400).send("invalid");
    }

    const eventType = evt?.data?.attributes?.type;
    const resource  = evt?.data?.attributes?.data; // the actual source / payment resource

    try {
      // ── source.chargeable: GCash payment was authorised — charge it now ──
      if (eventType === "source.chargeable") {
        const sourceId = resource?.id;
        const attrs    = resource?.attributes || {};
        const amountCentavos = attrs.amount || 0;
        const metadata = attrs.metadata || {};
        const bookingId = metadata.bookingId;

        if (sourceId && bookingId) {
          // 1. Charge the source
          const payment = await paymongo.createPaymentFromSource({
            sourceId,
            amount:      amountCentavos / 100,       // back to PHP
            description: `Booking ${metadata.bookingRef || bookingId}`,
            metadata,
          });

          // 1.1. Update payment row from source -> payment
          await Payment.findOneAndUpdate(
            {
              bookingId,
              $or: [
                { gatewayId: sourceId },
                { gatewayId: payment.paymentId },
              ],
            },
            {
              method: "gcash",
              gateway: "paymongo",
              gatewayId: payment.paymentId,
              gatewayType: "payment",
              gatewayStatus: payment.status,
              status: payment.status === "paid" ? "paid" : "pending",
              completedAt: payment.status === "paid" ? new Date() : undefined,
            },
            { new: true, sort: { submittedAt: -1 } },
          ).catch(() => {});

          // 2. Update booking status to confirmed + mark payment as paid
          await BookingService.findByIdAndUpdate(bookingId, {
            status:               "confirmed",
            paymentStatus:        "paid",
            paymentGatewayStatus: payment.status,
            paymentGatewayId:     payment.paymentId,
          });
        }
      }

      // ── payment.paid: payment completed (links, intents) ──────────────────
      if (eventType === "payment.paid") {
        const attrs    = resource?.attributes || {};
        const metadata = attrs.metadata || {};
        const bookingId = metadata.bookingId;

        await Payment.findOneAndUpdate(
          {
            $or: [
              { gatewayId: resource?.id },
              ...(bookingId ? [{ bookingId }] : []),
            ],
          },
          {
            gateway: "paymongo",
            gatewayId: resource?.id,
            gatewayType: "payment",
            gatewayStatus: attrs.status || "paid",
            status: "paid",
            completedAt: new Date(),
          },
          { new: true, sort: { submittedAt: -1 } },
        ).catch(() => {});

        if (bookingId) {
          await BookingService.findByIdAndUpdate(bookingId, {
            status:               "confirmed",
            paymentStatus:        "paid",
            paymentGatewayStatus: "paid",
            paymentGatewayId:     resource?.id,
          });
        }
      }

      // ── payment.failed ─────────────────────────────────────────────────────
      if (eventType === "payment.failed") {
        const attrs    = resource?.attributes || {};
        const metadata = attrs.metadata || {};
        const bookingId = metadata.bookingId;

        await Payment.findOneAndUpdate(
          {
            $or: [
              { gatewayId: resource?.id },
              ...(bookingId ? [{ bookingId }] : []),
            ],
          },
          {
            gateway: "paymongo",
            gatewayId: resource?.id,
            gatewayType: "payment",
            gatewayStatus: attrs.status || "failed",
            status: "failed",
          },
          { new: true, sort: { submittedAt: -1 } },
        ).catch(() => {});

        if (bookingId) {
          await BookingService.findByIdAndUpdate(bookingId, {
            paymentStatus:        "failed",
            paymentGatewayStatus: "failed",
          });
        }
      }

      // Delegate to controller for any additional handling
      try {
        await paymentController.handleGatewayWebhook(evt);
      } catch (ce) {
        // non-fatal; controller may not handle all event types
      }

      return res.status(200).send("OK");
    } catch (err) {
      console.error("paymongo webhook processing error", err.message);
      return res.status(500).send("error");
    }
  },
);

module.exports = router;

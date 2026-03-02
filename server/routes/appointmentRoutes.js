const express = require("express");
const router = express.Router();
const auth = require("../middleware/authenticate");
const audit = require("../utils/audit");
const BookingService = require("../models/BookingService");
const User = require("../models/User");
const Service = require("../models/Service");
const CoreService = require("../models/CoreService");
const RepairService = require("../models/RepairService");
const axios = require("axios");
const googleCalendarSync = require("../utils/googleCalendarSync");
const { sendBookingConfirmationEmail, sendTechnicianNotificationEmail } = require("../utils/mailer");
const paymongo = require("../utils/paymongo");
const fs = require("fs");
const path = require("path");

// ─── Helper ────────────────────────────────────────────────────────────────
function generateBookingReference() {
  const now = new Date();
  const d = now.toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusion
  let rand = "";
  for (let i = 0; i < 4; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  return `RACS-${d}-${rand}`;
}

function minutesTo12h(m) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${String(h12).padStart(2, "0")}:${String(min).padStart(2, "0")} ${ampm}`;
}

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

function deriveBookingEndMinutes(booking, defaultServiceDuration = 60) {
  const bStart = parseMinuteValue(booking.startTime);
  const explicitEnd = parseMinuteValue(booking.endTime);
  if (Number.isFinite(explicitEnd) && explicitEnd > bStart) return explicitEnd;
  const serviceDuration = Number(booking.serviceDurationMinutes) || defaultServiceDuration;
  const travelDuration = Math.max(0, Number(booking.travelTime) || 0);
  if (!Number.isFinite(bStart)) return NaN;
  return bStart + serviceDuration + travelDuration;
}

function isCoordinateLikeText(value) {
  if (typeof value !== "string") return false;
  const raw = value.trim();
  if (!raw) return false;
  return /^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/.test(raw);
}

async function reverseGeocodeAddress(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;
    const { data } = await axios.get(url, {
      timeout: 7000,
      headers: {
        "User-Agent": "RACS-Booking/1.0",
      },
    });
    return (data && (data.display_name || data.name)) ? String(data.display_name || data.name).trim() : "";
  } catch (err) {
    return "";
  }
}

async function getTechnicianIdsToMatch(candidateId) {
  const ids = new Set();
  if (!candidateId) return [];
  ids.add(String(candidateId));
  try {
    const Technician = require("../models/Technician");
    const byTechId = await Technician.findById(candidateId).select("_id user").lean();
    if (byTechId) {
      if (byTechId._id) ids.add(String(byTechId._id));
      if (byTechId.user) ids.add(String(byTechId.user));
    } else {
      const byUserId = await Technician.findOne({ user: candidateId })
        .select("_id user")
        .lean();
      if (byUserId) {
        if (byUserId._id) ids.add(String(byUserId._id));
        if (byUserId.user) ids.add(String(byUserId.user));
      }
    }
  } catch (err) {
    console.warn("getTechnicianIdsToMatch failed", err && err.message);
  }
  return Array.from(ids);
}

async function assertNoTechnicianOverlap({
  technicianId,
  bookingDate,
  startMin,
  endMin,
  excludeAppointmentId,
}) {
  if (!technicianId || !Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) return;

  const dayStart = new Date(bookingDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(bookingDate);
  dayEnd.setHours(23, 59, 59, 999);
  const technicianIds = await getTechnicianIdsToMatch(technicianId);

  const query = {
    bookingDate: { $gte: dayStart, $lte: dayEnd },
    status: { $nin: ["cancelled"] },
    technicianId: technicianIds.length ? { $in: technicianIds } : technicianId,
  };
  if (excludeAppointmentId) {
    query._id = { $ne: excludeAppointmentId };
  }

  const existing = await BookingService.find(query).lean();
  for (const b of existing) {
    const bStart = parseMinuteValue(b.startTime);
    if (!Number.isFinite(bStart)) continue;
    const bEnd = deriveBookingEndMinutes(b);
    if (!Number.isFinite(bEnd) || bEnd <= bStart) continue;
    if (startMin < bEnd && endMin > bStart) {
      throw new Error(
        `That time slot overlaps an existing booking (${minutesTo12h(bStart)}–${minutesTo12h(bEnd)}). Please choose a different time.`,
      );
    }
  }
}

async function resolveTechnicianRefId(candidateId) {
  if (!candidateId) return candidateId;
  try {
    const Technician = require("../models/Technician");
    const byTechId = await Technician.findById(candidateId).select("_id").lean();
    if (byTechId && byTechId._id) return byTechId._id;

    const byUserId = await Technician.findOne({ user: candidateId })
      .select("_id")
      .lean();
    if (byUserId && byUserId._id) return byUserId._id;
  } catch (err) {
    console.warn("resolveTechnicianRefId failed", err && err.message);
  }
  return candidateId;
}

// lightweight public booking endpoint used by front-end
// require login so only authenticated customers can create a booking
router.post("/create", auth.authenticate, async (req, res) => {
  let {
    serviceId,
    date,
    timeStart,
    selectedTimeLabel,
    technicianId,
    customerLocation,
    paymentMethod,
    gcashPhone,
    downpaymentAmount,
    travelFare,
    travelTime,
    estimatedFee,
    issueDescription,
    cashNotes,
  } = req.body;
  // normalize client-side "cash" into database value "cod"
  if (paymentMethod === "cash") paymentMethod = "cod";

  // ── Payment validation ────────────────────────────────────────────────
  if (paymentMethod === "gcash") {
    // GCash is now processed entirely via PayMongo — no manual proof required.
    // We only need the booking data; the PayMongo source is created post-save.
    // Optional gcash phone stored for reference only.
  }
  if (paymentMethod === "cod") {
    // enforce downpayment for cash bookings
    const down = Number(req.body.downpaymentAmount || 0);
    if (!down || down <= 0) {
      return res
        .status(400)
        .json({ error: "A downpayment amount is required for cash bookings." });
    }
    req.body.downpaymentAmount = down;
  }

  const startMin = parseInt(timeStart, 10);
  if (isNaN(startMin))
    return res.status(400).json({ error: "Invalid time slot." });

  const bookingDate = date ? new Date(date + "T00:00:00") : new Date();
  bookingDate.setHours(0, 0, 0, 0);

  try {
    if (technicianId) {
      technicianId = await resolveTechnicianRefId(technicianId);
    }

    // ── 1. Resolve service duration so we can compute endTime ────────────
    let serviceDuration = 60;
    let serviceName = "";
    let servicePrice = 0;
    let serviceModelName = "CoreService";
    let serviceSnap = null;
    if (serviceId) {
      try {
        let svc = await CoreService.findById(serviceId).lean();
        if (svc) {
          serviceModelName = "CoreService";
          serviceDuration = svc.durationMinutes || svc.duration || 60;
          serviceName = svc.name || "";
          servicePrice = svc.basePrice || 0;
          serviceSnap = { _id: svc._id, name: svc.name, description: svc.description, basePrice: svc.basePrice };
        } else {
          svc = await RepairService.findById(serviceId).lean();
          if (svc) {
            serviceModelName = "RepairService";
            serviceDuration = svc.estimatedDurationMinutes || svc.duration || 60;
            serviceName = svc.name || "";
            servicePrice = svc.basePrice || 0;
            serviceSnap = { _id: svc._id, name: svc.name, description: (svc.commonFaults || []).join(", "), basePrice: svc.basePrice };
          }
        }
      } catch (e) {
        console.warn("booking: service lookup failed", e.message);
      }
    }
    const travelMins = Number(travelTime) || 0;
    const totalDur   = serviceDuration + travelMins;
    const endMin     = startMin + totalDur;

    // ── 2. Overlap-aware conflict check ──────────────────────────────────
    if (technicianId) {
      try {
        await assertNoTechnicianOverlap({
          technicianId,
          bookingDate,
          startMin,
          endMin,
        });
      } catch (overlapErr) {
        return res.status(409).json({ error: overlapErr.message });
      }
    }

    // ── 3. Generate unique booking reference (retry up to 5 times) ────────
    let bookingReference = null;
    for (let i = 0; i < 5; i++) {
      const ref = generateBookingReference();
      const exists = await BookingService.findOne({ bookingReference: ref }).lean();
      if (!exists) { bookingReference = ref; break; }
    }
    if (!bookingReference) bookingReference = generateBookingReference(); // last resort

    // ── 4. Build booking document ─────────────────────────────────────────
    const fare = Number(travelFare) || 0;
    const fee  = Number(estimatedFee) || (servicePrice + fare) || 0;

    const appointmentData = {
      bookingReference,
      serviceId,
      serviceModel:  serviceModelName,
      service:       serviceSnap,
      servicePrice,
      serviceDurationMinutes: serviceDuration,
      bookingDate,
      startTime: String(startMin),
      endTime:   String(endMin),        // ← stored for overlap checks on future bookings
      selectedTimeLabel:
        (selectedTimeLabel && String(selectedTimeLabel).trim()) ||
        `${minutesTo12h(startMin)} – ${minutesTo12h(startMin + serviceDuration)}`,
      technicianId: technicianId || undefined,
      status: "pending",
      paymentMethod: paymentMethod || "cod",
      // gcash phone (optional reference for GCash via PayMongo bookings)
      gcashNumber:  (req.body.gcashPhone || undefined),
      downpaymentAmount: req.body.downpaymentAmount || undefined,
      paymentNotes:  cashNotes || undefined,
      travelFare:  fare || undefined,
      travelTime:  Number.isFinite(travelMins) ? travelMins : undefined,
      estimatedFee: fee || undefined,
      issueDescription: issueDescription || undefined,
    };

    // attach customer location
    if (customerLocation && typeof customerLocation === "object") {
      const loc = {};
      let addressText =
        typeof customerLocation.address === "string"
          ? customerLocation.address.trim()
          : "";
      if (isCoordinateLikeText(addressText)) {
        addressText = "";
      }
      const lat = parseFloat(customerLocation.lat || customerLocation.latitude);
      const lng = parseFloat(customerLocation.lng || customerLocation.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        loc.coordinates = { type: "Point", coordinates: [lng, lat] };
        if (!addressText) {
          addressText = await reverseGeocodeAddress(lat, lng);
        }
      }
      if (addressText) loc.address = addressText;
      if (loc.address || loc.coordinates) appointmentData.location = loc;
    }

    // attach customer snapshot
    if (req.user) {
      appointmentData.customerId = req.user._id;
      appointmentData.customer = {
        _id:     req.user._id,
        name:    req.user.name || req.user.fullName || "",
        email:   req.user.email || "",
        phone:   req.user.phone || req.user.mobile || "",
        address: req.user.address || "",
      };
    }

    // ── 5. Save ───────────────────────────────────────────────────────────
    const appointment = new BookingService(appointmentData);
    await appointment.save();

    // ── 6. Audit log ──────────────────────────────────────────────────────
    try {
      await audit.log({
        action:     "BOOKING_CREATED",
        userId:     req.user?._id,
        targetId:   appointment._id,
        targetModel:"BookingService",
        details:    { reference: bookingReference, date, startMin, endMin, technicianId, serviceName },
      });
    } catch (e) { /* non-fatal */ }

    // ── 7. Post-booking notifications (fire-and-forget) ───────────────────
    const dateLabel = bookingDate.toLocaleDateString("en-PH", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    const timeLabel = `${minutesTo12h(startMin)} – ${minutesTo12h(startMin + serviceDuration)}`;
    const totalLabel = travelMins > 0
      ? `${minutesTo12h(startMin)} – ${minutesTo12h(endMin)} (incl. ${travelMins}m travel)`
      : timeLabel;

    // Customer confirmation email
    const customerEmail = req.user?.email;
    const customerName  = req.user?.name || req.user?.fullName || "Valued Customer";
    if (customerEmail) {
      sendBookingConfirmationEmail({
        to:               customerEmail,
        customerName,
        bookingReference,
        serviceName,
        dateLabel,
        timeLabel,
        totalLabel,
        paymentMethod:    appointmentData.paymentMethod,
        estimatedFee:     fee,
        locationAddress:  customerLocation?.address || "",
        issueDescription: issueDescription || "",
        travelMins,
        serviceDuration,
      }).catch((e) => console.warn("customer email failed", e.message));
    }

    // Technician notification email (best-effort: look up email)
    if (technicianId) {
      (async () => {
        try {
          const Technician = require("../models/Technician");
          const tech = await Technician.findById(technicianId).lean();
          const techEmail = tech?.email || tech?.user?.email;
          const techName  = tech?.name || tech?.fullName || "Technician";
          if (techEmail) {
            await sendTechnicianNotificationEmail({
              to:               techEmail,
              technicianName:   techName,
              customerName,
              bookingReference,
              serviceName,
              dateLabel,
              timeLabel,
              totalLabel,
              locationAddress:  customerLocation?.address || "",
              issueDescription: issueDescription || "",
            });
          }
        } catch (e) {
          console.warn("technician email failed", e.message);
        }
      })();
    }

    // ── 8. If GCash, create a PayMongo GCash Source and return redirect ──
    let paymongoData = null;
    if (paymentMethod === "gcash") {
      try {
        const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
        const gcashAmt = fee || (Number(req.body.downpaymentAmount) || 0);
        const source = await paymongo.createGcashSource({
          amount:        gcashAmt,
          description:   `Booking #${bookingReference} – ${serviceName}`,
          successUrl:    `${baseUrl}/payment/success?ref=${bookingReference}&method=gcash`,
          failedUrl:     `${baseUrl}/payment/failed?ref=${bookingReference}&method=gcash`,
          billingName:   req.user?.name || req.user?.fullName || undefined,
          billingEmail:  req.user?.email || undefined,
          billingPhone:  req.body.gcashPhone || undefined,
          metadata: {
            bookingId:  String(appointment._id),
            bookingRef: bookingReference,
            serviceId:  String(serviceId || ""),
          },
        });
        // store the source id on the booking so webhook can match it
        await BookingService.findByIdAndUpdate(appointment._id, {
          paymentGatewayId:     source.sourceId,
          paymentGatewayStatus: source.status,
        }).catch(() => {});
        paymongoData = { redirect: source.checkoutUrl, sourceId: source.sourceId };
      } catch (pmErr) {
        console.error("PayMongo GCash source creation failed", pmErr.response?.data || pmErr.message);
        // Return a graceful error — don't silently swallow it; the booking is saved but payment needs retry
        return res.status(202).json({
          success:    true,
          bookingId:  appointment._id,
          bookingReference,
          date:       dateLabel,
          time:       timeLabel,
          serviceName,
          estimatedFee: fee,
          paymongoError: "Could not initiate GCash checkout. Please contact support with your booking reference.",
        });
      }
    }

    // ── 9. Respond ────────────────────────────────────────────────────────
    const respObj = {
      success:          true,
      bookingId:        appointment._id,
      bookingReference,
      date:             dateLabel,
      time:             timeLabel,
      serviceName,
      estimatedFee:     fee,
    };
    if (paymongoData) {
      respObj.paymongo = paymongoData;
    }
    return res.json(respObj);
  } catch (err) {
    console.error("booking create error", err);
    return res.status(500).json({ error: err.message || "could not create" });
  }
});

// GET / - list appointments with optional filters
// ?upcoming=1  => bookings from today onward
// ?requests=1  => booking requests (status=pending)
// supports ?limit and ?page
router.get("/", async (req, res) => {
  try {
    const q = req.query || {};
    const limit = Math.min(Math.max(1, Number(q.limit) || 100), 1000);
    const page = Math.max(0, Number(q.page) || 0);

    const filter = {};
    const toDayStart = (value) => {
      const d = new Date(String(value) + "T00:00:00");
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const toDayEnd = (value) => {
      const d = toDayStart(value);
      if (!d) return null;
      d.setHours(23, 59, 59, 999);
      return d;
    };

    if (q.date) {
      const ds = toDayStart(q.date);
      const de = toDayEnd(q.date);
      if (ds && de) filter.bookingDate = { $gte: ds, $lte: de };
    }

    if (q.start || q.end) {
      const existing = filter.bookingDate || {};
      const ds = q.start ? toDayStart(q.start) : null;
      const de = q.end ? toDayEnd(q.end) : null;
      if (ds) existing.$gte = ds;
      if (de) existing.$lte = de;
      if (existing.$gte || existing.$lte) filter.bookingDate = existing;
    }

    if (q.upcoming) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const existing = filter.bookingDate || {};
      existing.$gte = existing.$gte ? new Date(Math.max(existing.$gte.getTime(), today.getTime())) : today;
      filter.bookingDate = existing;
    }
    if (q.requests) {
      filter.status = "pending";
    }
    if (q.status && q.status !== "all") filter.status = q.status;

    // basic text search (customer name/service)
    if (q.search) {
      const re = new RegExp(
        q.search.replace(/[.*+?^${}()|\\[\\]\\\\]/g, ""),
        "i",
      );
      filter.$or = [
        { serviceType: re },
        // look in embedded customer snapshot fields – the older code
        // also handled `customer` string for backwards compatibility
        { "customer.name": re },
        { "customer.email": re },
        { "customer.phone": re },
        { customer: re },
      ];
    }

    let items = [];
    try {
      items = await BookingService.find(filter)
        .sort({ bookingDate: 1, startTime: 1 })
        .skip(page * limit)
        .limit(limit)
        .populate("serviceId") // may fail for legacy docs missing refPath values
        .populate("technicianId")
        .lean();
    } catch (populateErr) {
      // Fallback for legacy/partial records: return raw docs instead of 500
      console.warn("GET /appointments populate fallback:", populateErr && populateErr.message);
      items = await BookingService.find(filter)
        .sort({ bookingDate: 1, startTime: 1 })
        .skip(page * limit)
        .limit(limit)
        .lean();
    }
    // insert technicianName for each item so client code can rely on it
    items = items.map((b) => {
      if (!b.technicianName) {
        if (b.technician && b.technician.name) {
          b.technicianName = b.technician.name;
        } else if (b.technicianId && typeof b.technicianId === "object") {
          b.technicianName =
            b.technicianId.name || b.technicianId.fullName ||
            ((b.technicianId.firstName || "") + " " + (b.technicianId.lastName || "")).trim();
        }
      }
      return b;
    });
    return res.json({ items, count: items.length });
  } catch (err) {
    console.error("GET /appointments error", err);
    return res.status(500).json({ error: "Failed to list appointments" });
  }
});

// GET /today - helper used by dashboard; return bookings with today's date
router.get("/today", async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const items = await BookingService.find({
      bookingDate: { $gte: today, $lt: tomorrow },
    })
      .sort({ startTime: 1 })
      .lean();
    return res.json({ items });
  } catch (err) {
    console.error("GET /appointments/today error", err);
    return res
      .status(500);
  }
});

// helper endpoint for delivering proof images or paths stored in appointment docs
router.get("/proof/:token", async (req, res) => {
  try {
    const raw = decodeURIComponent(req.params.token || "");
    // data URI? convert and send binary
    if (/^data:/i.test(raw)) {
      const m = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
      if (m) {
        const mime = m[1];
        const dataBuf = Buffer.from(m[2], "base64");
        return res.type(mime).send(dataBuf);
      }
      return res.status(400).send("Invalid data URI");
    }

    // http(s) -> redirect
    if (/^https?:\/\//i.test(raw)) {
      return res.redirect(raw);
    }

    // server-relative path (starts with /) -> serve from public folder
    if (raw.startsWith("/")) {
      const publicPath = path.join(__dirname, "..", "public", raw.replace(/^\//, ""));
      return res.sendFile(publicPath, (err) => {
        if (err) res.status(404).send("Not found");
      });
    }

    // look for file under uploads/payment_proofs (custom folder)
    const uploadDir = path.join(__dirname, "..", "uploads", "payment_proofs");
    const safeName = path.normalize(raw).replace(/^\.\.(\/|\\)/, "");
    const fp = path.join(uploadDir, safeName);
    if (fs.existsSync(fp)) {
      return res.sendFile(fp);
    }

    // maybe raw is bare base64 string; guess jpeg
    if (/^[A-Za-z0-9+/]+=*$/.test(raw)) {
      const dataBuf = Buffer.from(raw, "base64");
      return res.type("image/jpeg").send(dataBuf);
    }

    res.status(404).send("Proof not found");
  } catch (err) {
    console.error("proof route error", err);
    res.status(500).send("Server error");
  }
});

// GET /:id - single appointment
router.get("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const appt = await BookingService.findById(id).populate("serviceId").lean();
    if (!appt) return res.status(404).json({ error: "Appointment not found" });
    return res.json({ appointment: appt });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load appointment" });
  }
});

// GET /:id - single appointment
router.get("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const appt = await BookingService.findById(id).populate("serviceId").lean();
    if (!appt) return res.status(404).json({ error: "Appointment not found" });
    return res.json({ appointment: appt });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load appointment" });
  }
});

// Approve appointment (admin/secretary)
router.post(
  "/:id/approve",
  auth.authenticate,
  auth.requireRole(["admin", "secretary"]),
  async (req, res) => {
    try {
      const id = req.params.id;
      const appt = await BookingService.findById(id);
      if (!appt)
        return res.status(404).json({ error: "Appointment not found" });

      // normalize technician reference so downstream schedule/calendar queries
      // (which use Technician._id) can pick up this confirmed booking.
      if (appt.technicianId) {
        appt.technicianId = await resolveTechnicianRefId(appt.technicianId);
      }

      appt.status = "confirmed";
      await appt.save();

      // Server-side: create Google Calendar event when appointment is confirmed
      if (googleCalendarSync.isConfigured() && !appt.googleCalendarEventId) {
        try {
          // determine duration (best‑effort) from whatever service document is linked
          let duration = 60;
          if (appt.serviceId) {
            // serviceId may already be populated; fall back to raw ObjectId properties
            const svc = appt.serviceId;
            if (svc.durationMinutes) duration = svc.durationMinutes;
            else if (svc.duration) duration = svc.duration;
            else if (svc.estimatedDurationMinutes)
              duration = svc.estimatedDurationMinutes;
          }

          const created = await googleCalendarSync.createEventForBooking({
            booking: appt,
            durationMinutes: duration,
          });
          if (created && created.eventId) {
            appt.googleCalendarEventId = created.eventId;
            appt.googleCalendarId = created.calendarId || appt.googleCalendarId;
            appt.googleCalendarHtmlLink =
              created.raw?.htmlLink ||
              created.htmlLink ||
              appt.googleCalendarHtmlLink;
            await appt.save();
          }
        } catch (err) {
          console.warn(
            "Failed to sync approved appointment to Google Calendar",
            err && (err.message || err),
          );
        }
      }

      await audit.logEvent({
        actor: req.user && req.user._id,
        target: appt.customerId || appt.customer,
        action: "appointment.approve",
        module: "appointments",
        req,
        details: { appointmentId: id },
      });
      return res.json({ message: "Appointment approved", appointment: appt });
    } catch (err) {
      console.error("approve error", err);
      return res.status(500).json({ error: "Failed to approve appointment" });
    }
  },
);

// Cancel appointment (admin/secretary)
router.post(
  "/:id/cancel",
  auth.authenticate,
  auth.requireRole(["admin", "secretary"]),
  async (req, res) => {
    try {
      const id = req.params.id;
      const appt = await BookingService.findById(id);
      if (!appt)
        return res.status(404).json({ error: "Appointment not found" });
      appt.status = "cancelled";
      await appt.save();

      // server-side: remove calendar event if present
      if (googleCalendarSync.isConfigured() && appt.googleCalendarEventId) {
        try {
          await googleCalendarSync.deleteEvent({
            eventId: appt.googleCalendarEventId,
            calendarIdOverride: appt.googleCalendarId,
          });
          appt.googleCalendarEventId = undefined;
          appt.googleCalendarId = undefined;
          appt.googleCalendarHtmlLink = undefined;
          await appt.save();
        } catch (e) {
          console.warn(
            "Failed to delete calendar event on cancel",
            e && e.message,
          );
        }
      }

      // TimeSlot model removed; no timeslot release to perform

      await audit.logEvent({
        actor: req.user && req.user._id,
        target: appt.customerId || appt.customer,
        action: "appointment.cancel",
        module: "appointments",
        req,
        details: { appointmentId: id },
      });
      return res.json({ message: "Appointment cancelled", appointment: appt });
    } catch (err) {
      console.error("cancel error", err);
      return res.status(500).json({ error: "Failed to cancel appointment" });
    }
  },
);

// Create appointment / booking request
router.post("/", auth.authenticate, async (req, res) => {
  try {
    let {
      customerName,
      customerEmail,
      service,
      serviceId,
      date,
      time,
      technicianId,
      notes,
      issueDescription,
      paymentMethod,
      gcashNumber,
      paymentReference,
      paymentProof,
    } = req.body;

    if (paymentMethod === "cash") paymentMethod = "cod";

    // validate payment info
    if (paymentMethod === "gcash") {
      if (!gcashNumber?.toString().trim())
        return res.status(400).json({ error: "GCash number is required." });
      if (!paymentReference?.toString().trim())
        return res.status(400).json({ error: "Payment reference is required." });
      if (!paymentProof?.toString().trim())
        return res.status(400).json({ error: "Proof of payment is required." });
    }
    if (paymentMethod === "cod") {
      const down = Number(req.body.downpaymentAmount || 0);
      if (!down || down <= 0) {
        return res
          .status(400)
          .json({ error: "A downpayment is required for cash bookings." });
      }
      req.body.downpaymentAmount = down;
    }
    if (paymentMethod === "cash") paymentMethod = "cod";

    // normalize any bare base64 strings
    if (paymentProof && typeof paymentProof === "string") {
      if (/^[A-Za-z0-9+/]+={0,2}$/.test(paymentProof)) {
        paymentProof = "data:image/jpeg;base64," + paymentProof;
      }
    }

    if (technicianId) {
      technicianId = await resolveTechnicianRefId(technicianId);
    }

    let customerId = null;
    if (customerEmail) {
      const user = await User.findOne({
        email: String(customerEmail).toLowerCase().trim(),
      });
      if (user) customerId = user._id;
    }

    const bookingDate = date ? new Date(date + "T00:00:00") : new Date();
    const doc = new BookingService({
      customerId: customerId || undefined,
      customer: customerId ? undefined : customerName || "",
      serviceId: serviceId || undefined,
      serviceType: service || "core",
      bookingDate,
      startTime: time || undefined,
      technicianId: technicianId || undefined,
      status: "pending",
      notes: notes || "",
      issueDescription: issueDescription || undefined,
      // copy payment info from request
      paymentMethod: paymentMethod || undefined,
      gcashNumber: gcashNumber || undefined,
      paymentReference: paymentReference || undefined,
      downpaymentAmount: downpaymentAmount || undefined,
      paymentProof: paymentProof || undefined,
    });

    await doc.save();

    // after saving, record payment transaction(s)
    try {
      const Payment = require("../models/Payment");
      if (paymentMethod === "cash" || paymentMethod === "cod") {
        const p = new Payment({
          bookingId: doc._id,
          amount: downpaymentAmount || 0,
          method: "cod",
          type: "downpayment",
          status: "pending",
        });
        await p.save();
      } else if (paymentMethod === "gcash") {
        const p = new Payment({
          bookingId: doc._id,
          amount: downpaymentAmount || 0, // treat as whatever the customer submitted
          method: "gcash",
          type: "downpayment",
          reference: paymentReference || undefined,
          proofUrl: paymentProof || undefined,
          status: "pending",
        });
        await p.save();
      } else if (paymentMethod === "bank") {
        const p = new Payment({
          bookingId: doc._id,
          amount: downpaymentAmount || 0,
          method: "bank",
          type: "downpayment",
          reference: paymentReference || undefined,
          status: "pending",
        });
        await p.save();
      } else if (paymentMethod === "other") {
        const p = new Payment({
          bookingId: doc._id,
          amount: downpaymentAmount || 0,
          method: "other",
          type: "downpayment",
          notes: req.body.notes || undefined,
          status: "pending",
        });
        await p.save();
      } else if (paymentMethod === "paymongo") {
        // create payment record and start PayMongo intent
        const p = new Payment({
          bookingId: doc._id,
          amount: downpaymentAmount || 0,
          method: "paymongo",
          gateway: "paymongo",
          type: "downpayment",
          status: "pending",
        });
        await p.save();

        // create PayMongo intent
        try {
          const paymongo = require("../utils/paymongo");
          const intentData = await paymongo.createPaymentIntent({
            amount: Math.round((downpaymentAmount || 0) * 100),
            currency: "PHP",
            description: `Downpayment for booking ${doc._id}`,
            metadata: { bookingId: String(doc._id), paymentId: String(p._id) },
          });
          if (intentData && intentData.data) {
            p.gatewayId = intentData.data.id;
            p.gatewayType = intentData.data.type;
            p.gatewayStatus = intentData.data.attributes_status;
            await p.save();
            // record gateway info on booking too for quick lookup
            doc.gateway = "paymongo";
            doc.gatewayId = intentData.data.id;
            doc.gatewayStatus = intentData.data.attributes.status;
            await doc.save();
            // send client details back to front-end via response outer scope
            // (we'll attach to respObj later)
            res.locals.paymongo = {
              clientSecret: intentData.data.attributes.client_secret,
              redirect: intentData.data.attributes.next_action?.redirect?.url,
            };
          }
        } catch (err) {
          console.warn("PayMongo intent creation failed", err && err.message);
        }
      }
    } catch (e) {
      console.warn("failed to create payment record for booking", e && e.message);
    }

    // If the booking is already confirmed at creation time, attempt server-side calendar sync
    if (doc.status === "confirmed" && googleCalendarSync.isConfigured()) {
      (async () => {
        try {
          // best-effort: attempt to create calendar event and persist event id
          const result = await googleCalendarSync.createEventForBooking({
            booking: doc,
          });
          if (result && result.eventId) {
            doc.googleCalendarEventId = result.eventId;
            doc.googleCalendarId = result.calendarId || doc.googleCalendarId;
            doc.googleCalendarHtmlLink =
              result.raw?.htmlLink ||
              result.htmlLink ||
              doc.googleCalendarHtmlLink;
            await doc.save();
          }
        } catch (err) {
          console.warn(
            "google calendar create failed (create)",
            err && (err.message || err),
          );
        }
      })();
    }

    // TimeSlot model removed; skipping timeslot sync for new bookings

    await audit.logEvent({
      actor: req.user && req.user._id,
      target: customerId || doc.customer,
      action: "appointment.create",
      module: "appointments",
      req,
      details: { bookingId: doc._id },
    });
    return res
      .status(201)
      .json({ message: "Booking request created", appointment: doc });
  } catch (err) {
    console.error("create appointment error", err);
    return res.status(500).json({ error: "Failed to create appointment" });
  }
});

// Update appointment (reschedule / edit)
router.put("/:id", auth.authenticate, async (req, res) => {
  try {
    const id = req.params.id;
    const appt = await BookingService.findById(id);
    if (!appt) return res.status(404).json({ error: "Appointment not found" });

    // keep previous date/time to sync timeslots if changed
    const prevDate = appt.bookingDate ? new Date(appt.bookingDate) : null;
    const prevTime = appt.startTime || null;

    const up = req.body || {};
    if (up.bookingDate)
      appt.bookingDate = new Date(up.bookingDate + "T00:00:00");
    if (up.startTime) appt.startTime = up.startTime;
    if (up.endTime) appt.endTime = up.endTime;
    if (up.status) appt.status = up.status;
    if (up.technicianId) {
      appt.technicianId = await resolveTechnicianRefId(up.technicianId);
      // grab technician snapshot immediately so we can show it without extra query
      try {
        const Technician = require("../models/Technician");
        const tech = await Technician.findById(appt.technicianId).lean();
        if (tech) {
          appt.technician = {
            _id: tech._id,
            name: tech.name || tech.fullName || "",
            email: tech.email || "",
            phone: tech.phone || tech.mobile || "",
          };
        }
      } catch (e) {
        // ignore lookup errors
      }
    }
    if (up.serviceType) appt.serviceType = up.serviceType;
    // if the serviceId changed, refresh snapshot
    if (up.serviceId && String(up.serviceId) !== String(appt.serviceId)) {
      appt.serviceId = up.serviceId;
      try {
        const CoreService = require("../models/CoreService");
        const RepairService = require("../models/RepairService");
        let svc = await CoreService.findById(up.serviceId).lean();
        if (svc) {
          appt.serviceModel = "CoreService";
          appt.service = {
            _id: svc._id,
            name: svc.name,
            description: svc.description,
            basePrice: svc.basePrice,
          };
        } else {
          svc = await RepairService.findById(up.serviceId).lean();
          if (svc) {
            appt.serviceModel = "RepairService";
            appt.service = {
              _id: svc._id,
              name: svc.name,
              description: svc.commonFaults ? svc.commonFaults.join(", ") : "",
              basePrice: svc.basePrice,
            };
          }
        }
      } catch (e) {
        console.warn('service lookup failed', e);
      }
    }
    if (up.paymentMethod) appt.paymentMethod = up.paymentMethod;
    if (up.travelFare !== undefined) appt.travelFare = Number(up.travelFare) || 0;
    if (up.travelTime !== undefined) appt.travelTime = Math.max(0, Number(up.travelTime) || 0);
    if (up.gcashNumber) appt.gcashNumber = up.gcashNumber;
    if (up.paymentReference) appt.paymentReference = up.paymentReference;
    if (up.paymentProof) {
      let pf = up.paymentProof;
      if (typeof pf === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(pf)) {
        pf = "data:image/jpeg;base64," + pf;
      }
      appt.paymentProof = pf;
    }

    if (up.location && typeof up.location === "object") {
      // normalize same as creation logic
      const loc = {};
      let addressText =
        typeof up.location.address === "string"
          ? up.location.address.trim()
          : "";
      if (isCoordinateLikeText(addressText)) {
        addressText = "";
      }
      const lat = parseFloat(
        up.location.lat || up.location.latitude || up.location.coords?.lat,
      );
      const lng = parseFloat(
        up.location.lng || up.location.longitude || up.location.coords?.lng,
      );
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        loc.coordinates = { type: "Point", coordinates: [lng, lat] };
        if (!addressText) {
          addressText = await reverseGeocodeAddress(lat, lng);
        }
      }
      if (addressText) loc.address = addressText;
      if (loc.address || loc.coordinates) appt.location = loc;
    }
    if (up.issueDescription !== undefined)
      appt.issueDescription = up.issueDescription;

    // overlap protection for reschedules/edits (same standards as create)
    const nextStart = parseMinuteValue(appt.startTime);
    const nextEndRaw = parseMinuteValue(appt.endTime);
    const nextEnd =
      Number.isFinite(nextEndRaw) && nextEndRaw > nextStart
        ? nextEndRaw
        : deriveBookingEndMinutes(appt);
    if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd) || nextEnd <= nextStart) {
      return res.status(400).json({ error: "Invalid appointment time range." });
    }

    // keep endTime normalized for future slot blocking
    appt.endTime = String(nextEnd);

    try {
      await assertNoTechnicianOverlap({
        technicianId: appt.technicianId,
        bookingDate: appt.bookingDate,
        startMin: nextStart,
        endMin: nextEnd,
        excludeAppointmentId: appt._id,
      });
    } catch (overlapErr) {
      return res.status(409).json({ error: overlapErr.message });
    }

    await appt.save();

    // Server-side calendar sync for updated appointments (best-effort)
    (async () => {
      try {
        if (googleCalendarSync.isConfigured()) {
          // if there is an existing event, update it
          if (appt.googleCalendarEventId) {
            try {
              await googleCalendarSync.updateEventForBooking({
                booking: appt,
                eventId: appt.googleCalendarEventId,
              });
            } catch (e) {
              console.warn(
                "Failed to update Google Calendar event for appointment",
                e && e.message,
              );
            }
          } else if (appt.status === "confirmed") {
            // create event if appointment became confirmed and no calendar event exists
            try {
              const created = await googleCalendarSync.createEventForBooking({
                booking: appt,
              });
              if (created && created.eventId) {
                appt.googleCalendarEventId = created.eventId;
                appt.googleCalendarId =
                  created.calendarId || appt.googleCalendarId;
                appt.googleCalendarHtmlLink =
                  created.raw?.htmlLink ||
                  created.htmlLink ||
                  appt.googleCalendarHtmlLink;
                await appt.save();
              }
            } catch (e) {
              console.warn(
                "Failed to create Google Calendar event for updated appointment",
                e && e.message,
              );
            }
          }
          // if appointment was cancelled, remove associated event
          if (appt.status === "cancelled" && appt.googleCalendarEventId) {
            try {
              await googleCalendarSync.deleteEvent({
                eventId: appt.googleCalendarEventId,
                calendarIdOverride: appt.googleCalendarId,
              });
              appt.googleCalendarEventId = undefined;
              appt.googleCalendarId = undefined;
              appt.googleCalendarHtmlLink = undefined;
              await appt.save();
            } catch (e) {
              console.warn(
                "Failed to delete Google Calendar event after cancellation",
                e && e.message,
              );
            }
          }
        }
      } catch (e) {
        /* ignore background sync errors */
      }
    })();

    // TimeSlot model removed; skipping timeslot sync on appointment update

    await audit.logEvent({
      actor: req.user && req.user._id,
      target: appt.customerId || appt.customer,
      action: "appointment.update",
      module: "appointments",
      req,
      details: { appointmentId: id },
    });
    return res.json({ message: "Appointment updated", appointment: appt });
  } catch (err) {
    console.error("update appointment error", err);
    return res.status(500).json({ error: "Failed to update appointment" });
  }
});

// Manual server-side Google Calendar sync (admin)
router.post(
  "/:id/google-sync",
  auth.authenticate,
  auth.requireRole(["admin", "secretary"]),
  async (req, res) => {
    try {
      if (!googleCalendarSync.isConfigured())
        return res
          .status(400)
          .json({ error: "Google Calendar sync not configured on server" });
      const id = req.params.id;
      const appt = await BookingService.findById(id);
      if (!appt)
        return res.status(404).json({ error: "Appointment not found" });

      // determine duration (best‑effort)
      let duration = 60;
      if (appt.serviceId) {
        const svc = appt.serviceId;
        if (svc && svc.durationMinutes) duration = svc.durationMinutes;
        else if (svc && svc.duration) duration = svc.duration;
        else if (svc && svc.estimatedDurationMinutes)
          duration = svc.estimatedDurationMinutes;
      }

      let result;
      if (appt.googleCalendarEventId) {
        // update existing
        result = await googleCalendarSync.updateEventForBooking({
          booking: appt,
          eventId: appt.googleCalendarEventId,
          durationMinutes: duration,
        });
        if (result && result.htmlLink)
          appt.googleCalendarHtmlLink = result.htmlLink;
        await appt.save();
        return res.json({
          message: "Calendar event updated",
          event: result,
          appointment: appt,
        });
      }

      // create new
      const created = await googleCalendarSync.createEventForBooking({
        booking: appt,
        durationMinutes: duration,
      });
      if (created && created.eventId) {
        appt.googleCalendarEventId = created.eventId;
        appt.googleCalendarId = created.calendarId || appt.googleCalendarId;
        appt.googleCalendarHtmlLink =
          created.raw?.htmlLink ||
          created.htmlLink ||
          appt.googleCalendarHtmlLink;
        await appt.save();
      }
      return res.json({
        message: "Calendar event created",
        created,
        appointment: appt,
      });
    } catch (err) {
      console.error("google-sync error", err);
      return res
        .status(500)
        .json({ error: "Failed to sync to Google Calendar" });
    }
  },
);

// Manual remove calendar event (admin)
router.post(
  "/:id/google-remove",
  auth.authenticate,
  auth.requireRole(["admin", "secretary"]),
  async (req, res) => {
    try {
      if (!googleCalendarSync.isConfigured())
        return res
          .status(400)
          .json({ error: "Google Calendar sync not configured on server" });
      const id = req.params.id;
      const appt = await BookingService.findById(id);
      if (!appt)
        return res.status(404).json({ error: "Appointment not found" });
      if (!appt.googleCalendarEventId)
        return res.status(400).json({
          error: "No calendar event associated with this appointment",
        });

      try {
        await googleCalendarSync.deleteEvent({
          eventId: appt.googleCalendarEventId,
          calendarIdOverride: appt.googleCalendarId,
        });
      } catch (e) {
        console.warn(
          "Failed to delete calendar event (manual)",
          e && e.message,
        );
      }

      appt.googleCalendarEventId = undefined;
      appt.googleCalendarId = undefined;
      await appt.save();
      return res.json({ message: "Calendar event removed", appointment: appt });
    } catch (err) {
      console.error("google-remove error", err);
      return res.status(500).json({ error: "Failed to remove calendar event" });
    }
  },
);

// Delete appointment
router.delete("/:id", auth.authenticate, async (req, res) => {
  try {
    const id = req.params.id;
    const appt = await BookingService.findByIdAndDelete(id);
    if (!appt) return res.status(404).json({ error: "Appointment not found" });

    // server-side: remove calendar event if present
    if (googleCalendarSync.isConfigured() && appt.googleCalendarEventId) {
      try {
        await googleCalendarSync.deleteEvent({
          eventId: appt.googleCalendarEventId,
          calendarIdOverride: appt.googleCalendarId,
        });
      } catch (e) {
        console.warn(
          "Failed to delete calendar event on appointment delete",
          e && e.message,
        );
      }
    }

    // TimeSlot model removed; no timeslot release to perform

    await audit.logEvent({
      actor: req.user && req.user._id,
      target: appt.customerId || appt.customer,
      action: "appointment.delete",
      module: "appointments",
      req,
      details: { appointmentId: id },
    });
    return res.json({ message: "Appointment deleted" });
  } catch (err) {
    console.error("delete appointment error", err);
    return res.status(500).json({ error: "Failed to delete appointment" });
  }
});

module.exports = router;

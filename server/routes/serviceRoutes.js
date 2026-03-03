const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Service = require("../models/Service");
const CoreService = require("../models/CoreService");
const RepairService = require("../models/RepairService");
const BookingService = require("../models/BookingService");

async function fetchJsonWithTimeout(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Helper: convert minutes -> 12-hour label
function minutesTo12HourLabel(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = ((h + 11) % 12) + 1;
  return `${String(hour12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${ampm}`;
}

// --- GET /api/services
// Returns both core services and repair services. Falls back to `Service` collection if detailed
// CoreService/RepairService documents are not present.
router.get("/", async (req, res) => {
  try {
    const core = await CoreService.find({ active: true }).lean().limit(100);
    const repairs = await RepairService.find({ active: true })
      .lean()
      .limit(100);

    // fallback to Service model when specialized collections are empty
    if ((!core || core.length === 0) && (!repairs || repairs.length === 0)) {
      const all = await Service.find({ active: true }).lean().limit(200);
      return res.json({
        coreServices: all.filter((s) => s.category === "service"),
        repairs: all.filter((s) => s.category === "repair"),
      });
    }

    return res.json({ coreServices: core, repairs });
  } catch (err) {
    console.error("GET /api/services failed", err && err.message);
    return res.status(500).json({ error: "Failed to load services" });
  }
});

// public endpoint used by booking calendar to retrieve technician schedule
// so that we can block dates when no tech is working.
// global schedule (all technicians combined)
router.get("/technician-schedule", async (req, res) => {
  try {
    const TechnicianSchedule = require("../models/TechnicianSchedule");
    const docs = await TechnicianSchedule.find({}).lean();
    const availableWeekdays = new Set();
    const restDates = new Set();
    docs.forEach((d) => {
      (d.workingDays || []).forEach((w) => {
        const dow = Number(w.dayOfWeek);
        if (Number.isInteger(dow) && dow >= 0 && dow < 7)
          availableWeekdays.add(dow);
      });
      (d.restDates || []).forEach((r) => {
        if (r && r.date) {
          const dKey = toIsoDate(new Date(r.date));
          restDates.add(dKey);
        }
      });
    });

    const nonWorkingWeekdays = [];
    for (let d = 0; d < 7; d++) {
      if (!availableWeekdays.has(d)) nonWorkingWeekdays.push(d);
    }

    return res.json({ nonWorkingWeekdays, restDates: Array.from(restDates) });
  } catch (err) {
    console.error(
      "GET /api/services/technician-schedule failed",
      err && err.message,
    );
    return res.status(500).json({ error: "failed" });
  }
});

// per-technician schedule for public booking UI
router.get("/technician-schedule/:id", async (req, res) => {
  try {
    const TechnicianSchedule = require("../models/TechnicianSchedule");
    const Technician = require("../models/Technician");
    let id = req.params.id;

    // primary lookup: schedule document whose technicianId matches the supplied id
    let doc = await TechnicianSchedule.findOne({ technicianId: id }).lean();

    // if not found, the id may actually be a user account id rather than a
    // Technician._id.  attempt to resolve the linked Technician record and
    // re-run the query using that identifier.
    if (!doc) {
      const tech = await Technician.findOne({ user: id }).select("_id").lean();
      if (tech) {
        id = tech._id.toString();
        doc = await TechnicianSchedule.findOne({ technicianId: id }).lean();
      }
    }

    if (!doc)
      return res.json({
        workingDays: [],
        nonWorkingWeekdays: [],
        restDates: [],
      });

    const availableWeekdays = new Set();
    const restDates = new Set();
    (doc.workingDays || []).forEach((w) => {
      const dow = Number(w.dayOfWeek);
      if (Number.isInteger(dow) && dow >= 0 && dow < 7)
        availableWeekdays.add(dow);
    });
    (doc.restDates || []).forEach((r) => {
      if (r && r.date) {
        const dKey = toIsoDate(new Date(r.date));
        restDates.add(dKey);
      }
    });

    const nonWorkingWeekdays = [];
    for (let d = 0; d < 7; d++) {
      if (!availableWeekdays.has(d)) nonWorkingWeekdays.push(d);
    }
    return res.json({
      workingDays: doc.workingDays || [],
      nonWorkingWeekdays,
      restDates: Array.from(restDates),
    });
  } catch (err) {
    console.error(
      "GET /api/services/technician-schedule/:id failed",
      err && err.message,
    );
    return res.status(500).json({ error: "failed" });
  }
});

// public endpoint returning current technician GPS coordinates.  This will
// be updated by the technician tracker page and polled by the customer UI.
router.get("/technician-location", async (req, res) => {
  try {
    const Technician = require("../models/Technician");
    const { id } = req.query;
    let tech;
    if (id) {
      tech = await Technician.findOne({ _id: id, active: true })
        .select("location user")
        .lean();
      if (!tech) {
        // maybe the caller passed a user id instead
        tech = await Technician.findOne({ user: id, active: true })
          .select("location user")
          .lean();
      }
    } else {
      tech = await Technician.findOne({ active: true })
        .select("location user")
        .lean();
    }
    if (tech && tech.location && tech.location.coordinates) {
      const [lng, lat] = tech.location.coordinates;
      return res.json({ lat, lng });
    }
    // fallback to static default
    return res.json({
      lat: (module.exports.defaultTechnicianLocation || {}).lat || 14.676049,
      lng: (module.exports.defaultTechnicianLocation || {}).lng || 121.043731,
    });
  } catch (err) {
    console.error(
      "GET /api/services/technician-location failed",
      err && err.message,
    );
    return res.status(500).json({ error: "failed" });
  }
});

// list active technicians for public booking UI
// technicians are stored as users with role "technician" rather than a
// separate Technician model, so query the User collection and build a
// friendly name.
router.get("/technicians", async (req, res) => {
  try {
    const User = require("../models/User");
    const docs = await User.find({ role: "technician", active: true })
      .select("firstName lastName name location")
      .lean();
    const techs = docs.map((u) => ({
      _id: u._id,
      name:
        u.name || u.fullName ||
        ((u.firstName || "") + " " + (u.lastName || "")).trim(),
      location: u.location,
    }));
    return res.json({ technicians: techs });
  } catch (err) {
    console.error("GET /api/services/technicians failed", err && err.message);
    return res.status(500).json({ error: "failed" });
  }
});

// helper used by the schedule endpoint
function toIsoDate(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// GET /api/services/geocode-suggest?q=<query>
// Proxy to Nominatim for address autocomplete (limited to Philippines)
router.get("/geocode-suggest", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ suggestions: [] });
    const url =
      "https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=ph&q=" +
      encodeURIComponent(q);
    const data = await fetchJsonWithTimeout(url, 5000);
    if (!Array.isArray(data)) return res.json({ suggestions: [] });
    const out = data.map((item) => ({
      display_name: item.display_name,
      lat: item.lat,
      lon: item.lon,
    }));
    return res.json({ suggestions: out });
  } catch (err) {
    console.error(
      "GET /api/services/geocode-suggest failed",
      err && err.message,
    );
    return res.status(500).json({ suggestions: [] });
  }
});

// GET /api/services/geocode?q=<query>
// proxy that returns one matching address to avoid CORS errors
router.get("/geocode", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({});
    const url =
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ph&q=" +
      encodeURIComponent(q);
    const data = await fetchJsonWithTimeout(url, 5000);
    if (Array.isArray(data) && data.length) {
      return res.json({
        lat: data[0].lat,
        lon: data[0].lon,
        display_name: data[0].display_name,
      });
    }
    return res.json({});
  } catch (err) {
    console.error("GET /api/services/geocode failed", err && err.message);
    return res.status(500).json({});
  }
});

// GET /api/services/ip-location
// Server-side IP geolocation proxy to avoid browser CORS/mixed-content issues.
router.get("/ip-location", async (req, res) => {
  try {
    const providers = [
      {
        name: "ipapi.co",
        url: "https://ipapi.co/json/",
        parse: (data) => ({
          lat: Number(data && data.latitude),
          lng: Number(data && data.longitude),
          city: (data && data.city) || null,
          country: (data && data.country_name) || null,
        }),
      },
      {
        name: "ipwho.is",
        url: "https://ipwho.is/",
        parse: (data) => {
          if (!data || data.success === false) return null;
          return {
            lat: Number(data.latitude),
            lng: Number(data.longitude),
            city: data.city || null,
            country: data.country || null,
          };
        },
      },
      {
        name: "ipwhois.app",
        url: "https://ipwhois.app/json/",
        parse: (data) => ({
          lat: Number(data && data.latitude),
          lng: Number(data && data.longitude),
          city: (data && data.city) || null,
          country: (data && data.country) || null,
        }),
      },
    ];

    for (const provider of providers) {
      const data = await fetchJsonWithTimeout(provider.url, 7000);
      if (!data) continue;
      const parsed = provider.parse(data);
      if (
        parsed &&
        Number.isFinite(parsed.lat) &&
        Number.isFinite(parsed.lng) &&
        parsed.lat >= -90 &&
        parsed.lat <= 90 &&
        parsed.lng >= -180 &&
        parsed.lng <= 180
      ) {
        return res.json({
          success: true,
          source: provider.name,
          coords: parsed,
        });
      }
    }

    return res.status(502).json({ success: false, error: "ip_lookup_failed" });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, error: "ip_lookup_exception" });
  }
});

// GET /api/services/osrm-route?coords=<lng,lat;lng,lat>
// Simple proxy to OSRM public routing API to avoid client-side CSP/CORS issues.
// Uses axios (already in package.json) for reliable HTTP in all Node versions.
router.get("/osrm-route", async (req, res) => {
  const axios = require("axios");
  try {
    const coordsRaw = String(req.query.coords || "").trim();
    // Expect exactly two coordinate pairs in the form "lng,lat;lng,lat"
    const m = coordsRaw.match(
      /^\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*;\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*$/,
    );
    if (!m) {
      return res.status(400).json({ error: "invalid_coords" });
    }
    const lng1 = Number(m[1]);
    const lat1 = Number(m[2]);
    const lng2 = Number(m[3]);
    const lat2 = Number(m[4]);
    if (
      !Number.isFinite(lng1) ||
      !Number.isFinite(lat1) ||
      !Number.isFinite(lng2) ||
      !Number.isFinite(lat2)
    ) {
      return res.status(400).json({ error: "invalid_coords" });
    }

    const coords = `${lng1},${lat1};${lng2},${lat2}`;
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&alternatives=false&steps=false`;
    console.log("[osrm-route] proxying:", url);
    const { data } = await axios.get(url, { timeout: 10000 });
    if (!data || !data.routes) {
      console.warn(
        "[osrm-route] OSRM returned unexpected body:",
        JSON.stringify(data).slice(0, 300),
      );
      return res.status(502).json({ error: "upstream_failed" });
    }
    console.log(
      "[osrm-route] OK, routes:",
      data.routes.length,
      "geometry pts:",
      (data.routes[0]?.geometry?.coordinates || []).length,
    );
    return res.json(data);
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data;
    console.error(
      "[osrm-route] error",
      status || err.code || err.message,
      body && JSON.stringify(body).slice(0, 300),
    );
    return res
      .status(502)
      .json({ error: "upstream_failed", detail: status || err.message });
  }
});

// Helper: parse "HH:MM" or "h:MM AM/PM" -> minutes-since-midnight (returns NaN on failure)
function parseTimeToMinutes(str) {
  if (!str) return NaN;
  str = str.toString().trim();
  // support stored minute-of-day values like "480"
  if (/^\d{1,4}$/.test(str)) {
    const mins = parseInt(str, 10);
    return Number.isFinite(mins) ? mins : NaN;
  }
  const m1 = str.match(/^(\d{1,2}):(\d{2})$/);
  if (m1) return parseInt(m1[1], 10) * 60 + parseInt(m1[2], 10);
  const m2 = str.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m2) {
    let hh = parseInt(m2[1], 10) % 12;
    if (m2[3].toUpperCase() === "PM") hh += 12;
    return hh * 60 + parseInt(m2[2], 10);
  }
  return NaN;
}

// GET /api/services/availability?serviceId=<id>&date=YYYY-MM-DD
// or GET /api/services/:id/availability?date=YYYY-MM-DD
// Returns only truly-available start times based on:
//   working hours, existing bookings (as blocked ranges), service duration, and travel time.
async function computeAvailability(serviceId, dateStr, technicianId, travelTime = 0) {
  try {
    const date = new Date(dateStr + "T00:00:00");
    if (Number.isNaN(date.getTime())) throw new Error("invalid_date");

    // ── 1. Load service duration (minutes) ────────────────────────────────
    let duration = 60;
    if (serviceId && mongoose.Types.ObjectId.isValid(serviceId)) {
      try {
        const svc = await Service.findById(serviceId).lean();
        if (svc && svc.duration) duration = svc.duration;
        else {
          const cs = await CoreService.findById(serviceId).lean();
          if (cs && cs.durationMinutes) duration = cs.durationMinutes;
          else {
            const rs = await RepairService.findById(serviceId).lean();
            if (rs && rs.estimatedDurationMinutes)
              duration = rs.estimatedDurationMinutes;
          }
        }
      } catch (e) {
        console.warn("computeAvailability: service lookup failed", serviceId, e.message);
      }
    }

    // total time a technician must be unavailable for this booking
    const totalDur = duration + (travelTime || 0);

    // ── 2. Load technician working blocks for this day-of-week ────────────
    let blocks = [{ start: 8 * 60, end: 17 * 60 }]; // default 8 AM – 5 PM
    if (technicianId && mongoose.Types.ObjectId.isValid(technicianId)) {
      try {
        const Technician = require("../models/Technician");
        const schedColl = require("../models/TechnicianSchedule");
        let techIdForSched = technicianId;
        let sched = await schedColl
          .findOne({ technicianId: techIdForSched })
          .lean();
        if (!sched) {
          const tech = await Technician.findOne({ user: technicianId })
            .select("_id")
            .lean();
          if (tech) {
            techIdForSched = tech._id.toString();
            sched = await schedColl
              .findOne({ technicianId: techIdForSched })
              .lean();
          }
        }
        if (sched && Array.isArray(sched.workingDays)) {
          const dow = date.getDay();
          const days = sched.workingDays.filter((w) => w.dayOfWeek === dow);
          if (days.length) {
            blocks = days.map((w) => ({
              start: w.startMinutes || 8 * 60,
              end: w.endMinutes || 17 * 60,
            }));
          } else {
            blocks = []; // non-working day
          }
        }
      } catch (e) {
        console.warn("computeAvailability: schedule lookup failed", technicianId, e.message);
      }
    }

    if (!blocks.length) return []; // no working hours → no slots

    // ── 3. Fetch ALL bookings for this technician on this date ────────────
    const busyRanges = [];
    if (technicianId) {
      try {
        const dayStart = new Date(date);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(date);
        dayEnd.setHours(23, 59, 59, 999);
        const busyStatuses = ["pending", "confirmed", "in-progress", "ongoing"];
        const Technician = require("../models/Technician");

        // support legacy mixed IDs where booking.technicianId may store either
        // Technician._id or linked User._id
        const techIdsToMatch = [String(technicianId)];
        const byTechId = await Technician.findById(technicianId)
          .select("_id user")
          .lean();
        if (byTechId) {
          if (byTechId._id) techIdsToMatch.push(String(byTechId._id));
          if (byTechId.user) techIdsToMatch.push(String(byTechId.user));
        } else {
          const byUserId = await Technician.findOne({ user: technicianId })
            .select("_id user")
            .lean();
          if (byUserId) {
            if (byUserId._id) techIdsToMatch.push(String(byUserId._id));
            if (byUserId.user) techIdsToMatch.push(String(byUserId.user));
          }
        }

        const uniqueTechIds = Array.from(new Set(techIdsToMatch));
        const bookings = await BookingService.find({
          bookingDate: { $gte: dayStart, $lte: dayEnd },
          status: { $in: busyStatuses },
          technicianId: { $in: uniqueTechIds },
        }).lean();

        for (const b of bookings) {
          const startMin = parseTimeToMinutes(b.startTime);
          if (Number.isNaN(startMin)) continue;
          let endMin = parseTimeToMinutes(b.endTime);
          if (Number.isNaN(endMin)) {
            // derive end from stored booking duration (service + travel),
            // fall back to current service duration
            const bookingDur =
              (Number(b.serviceDurationMinutes) || duration) +
              Math.max(0, Number(b.travelTime) || 0);
            endMin = startMin + bookingDur;
          }
          if (endMin > startMin) {
            busyRanges.push({ start: startMin, end: endMin });
          }
        }
      } catch (e) {
        console.warn("computeAvailability: booking lookup failed", e && e.message);
      }
    }

    // ── 4. Merge overlapping busy ranges ──────────────────────────────────
    busyRanges.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const r of busyRanges) {
      if (merged.length && r.start <= merged[merged.length - 1].end) {
        merged[merged.length - 1].end = Math.max(
          merged[merged.length - 1].end,
          r.end
        );
      } else {
        merged.push({ ...r });
      }
    }

    // ── 5. Find free gaps within each working block and generate slots ─────
    const result = [];
    for (const block of blocks) {
      let cursor = block.start;
      const gaps = [];

      for (const busy of merged) {
        if (busy.start >= block.end) break; // entirely beyond this block
        if (busy.end <= block.start) continue; // entirely before this block
        // gap before this busy period
        const gapEnd = Math.min(busy.start, block.end);
        if (gapEnd > cursor) gaps.push({ start: cursor, end: gapEnd });
        cursor = Math.max(cursor, Math.min(busy.end, block.end));
      }
      // trailing gap from last busy period to end of working block
      if (cursor < block.end) gaps.push({ start: cursor, end: block.end });

      // generate start times every 30 min where the full slot (travel + service)
      // fits entirely within the free gap
      for (const gap of gaps) {
        for (let t = gap.start; t + totalDur <= gap.end; t += 30) {
          const serviceEnd  = t + duration;
          const totalEnd    = t + totalDur;
          const travelMins  = travelTime || 0;
          // human-readable breakdown
          const durationLabel = duration >= 60
            ? (duration % 60 === 0
                ? `${duration / 60}h`
                : `${Math.floor(duration / 60)}h ${duration % 60}m`)
            : `${duration}m`;
          const travelLabel = travelMins > 0
            ? (travelMins >= 60
                ? `${Math.floor(travelMins / 60)}h ${travelMins % 60 > 0 ? travelMins % 60 + 'm' : ''}`
                : `${travelMins}m`)
            : null;
          const totalLabel = totalDur >= 60
            ? (totalDur % 60 === 0
                ? `${totalDur / 60}h`
                : `${Math.floor(totalDur / 60)}h ${totalDur % 60}m`)
            : `${totalDur}m`;
          result.push({
            startMinutes:    t,
            endMinutes:      serviceEnd,
            totalEndMinutes: totalEnd,
            durationMinutes: duration,
            travelMinutes:   travelMins,
            status: "available",
            // primary label: arrival window (start → service done)
            label: minutesTo12HourLabel(t) + " – " + minutesTo12HourLabel(serviceEnd),
            // full block label including travel
            blockLabel: minutesTo12HourLabel(t) + " – " + minutesTo12HourLabel(totalEnd),
            // breakdown shown below the time
            detail: travelLabel
              ? `🚗 ${travelLabel} travel · 🔧 ${durationLabel} service · ${totalLabel} total`
              : `🔧 ${durationLabel} service`,
          });
        }
      }
    }

    return result;
  } catch (err) {
    console.error("computeAvailability error", err, { serviceId, dateStr });
    return []; // degrade gracefully
  }
}

router.get("/availability", async (req, res) => {
  try {
    const { date, serviceId, technicianId, travelTime } = req.query;
    if (!date)
      return res.status(400).json({ error: "date is required (YYYY-MM-DD)" });
    // log parameters for debugging
    console.debug("availability request", { date, serviceId, technicianId, travelTime });
    let slots = [];
    let errMsg = null;
    try {
      const tt = travelTime ? Number(travelTime) || 0 : 0;
      slots = await computeAvailability(serviceId, date, technicianId, tt);
    } catch (err) {
      errMsg = err && (err.message || String(err));
      console.error("availability compute failed", errMsg, {
        date,
        serviceId,
        technicianId,
      });
    }
    const resp = { date, slots };
    if (errMsg && process.env.NODE_ENV !== "production") {
      resp.error = errMsg;
    }
    return res.json(resp);
  } catch (un) {
    console.error("availability handler crashed", un && (un.stack || un));
    return res.json({
      date: req.query.date || null,
      slots: [],
      error: "handler_exception",
    });
  }
});

router.get("/:id/availability", async (req, res) => {
  const id = req.params.id;
  const { date, technicianId } = req.query;
  if (!date)
    return res.status(400).json({ error: "date is required (YYYY-MM-DD)" });
  try {
    const slots = await computeAvailability(id, date, technicianId);
    return res.json({ date, slots });
  } catch (err) {
    return res.status(500).json({ error: "failed to compute availability" });
  }
});

// GET /api/services/:id - return a single service from any relevant collection
router.get("/:id", async (req, res) => {
  const id = req.params.id;
  try {
    let found = null;
    // try normalized Service collection first
    found = await Service.findById(id).lean();
    if (!found) found = await CoreService.findById(id).lean();
    if (!found) found = await RepairService.findById(id).lean();
    if (!found) return res.status(404).json({ error: "Service not found" });
    return res.json({ service: found });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load service" });
  }
});

// GET /api/services/:id/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD
// Returns sets of booked and blocked dates in the requested range (public endpoint used by booking UI)
router.get("/:id/calendar", async (req, res) => {
  try {
    const id = req.params.id;
    const { start, end } = req.query;
    const startDate = start ? new Date(start + "T00:00:00") : null;
    const endDate = end ? new Date(end + "T00:00:00") : null;
    if (
      (start && Number.isNaN(startDate.getTime())) ||
      (end && Number.isNaN(endDate.getTime()))
    )
      return res.status(400).json({ error: "invalid start/end" });

    // bookings -> bookedDates
    const bookedSet = new Set();
    const { technicianId } = req.query;
    const bq = { serviceId: id };
    if (technicianId) {
      let techIdForQuery = technicianId;
      if (mongoose.Types.ObjectId.isValid(technicianId)) {
        const Technician = require("../models/Technician");
        const tech = await Technician.findOne({ user: technicianId })
          .select("_id")
          .lean();
        if (tech) techIdForQuery = tech._id.toString();
      }
      bq.technicianId = techIdForQuery;
    }
    if (startDate || endDate) bq.bookingDate = {};
    if (startDate) bq.bookingDate.$gte = startDate;
    if (endDate) {
      const ed = new Date(endDate);
      ed.setHours(23, 59, 59, 999);
      bq.bookingDate.$lte = ed;
    }
    const bookings = await BookingService.find(bq).lean();
    bookings.forEach((b) => {
      if (!b.bookingDate) return;
      const d = new Date(b.bookingDate);
      bookedSet.add(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      );
    });

    // blockedDates collected from non-working days and public holidays
    const blockedSet = new Set();
    let nonWorkingDays = [];
    try {
      const ndq = {};
      if (startDate || endDate) ndq.date = {};
      if (startDate) ndq.date.$gte = startDate;
      if (endDate) {
        const ed3 = new Date(endDate);
        ed3.setHours(23, 59, 59, 999);
        ndq.date.$lte = ed3;
      }
      // include global day-offs (service=null) and service-specific ones
      ndq.$or = [
        { service: id },
        { service: { $exists: false } },
        { service: null },
      ];
      const NonWorkingDay = require("../models/NonWorkingDay");
      const ndocs = await NonWorkingDay.find(ndq).lean();
      ndocs.forEach((n) => {
        const d = new Date(n.date);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        blockedSet.add(iso);
        nonWorkingDays.push({ date: iso, note: n.note || "" });
      });
    } catch (e) {
      // ignore day-off lookup failures
      console.warn("calendar: failed to load non-working days", e && e.message);
    }

    // optionally include public holidays from configured provider (adds to blockedDates)
    try {
      const enabled = (process.env.PUBLIC_HOLIDAYS_ENABLED || "1") !== "0";
      const publicHolidays = [];
      if (enabled && startDate && endDate) {
        const provHeader = req.get("X-Provider");
        const provQuery = req.query.provider;
        const provider = (
          provQuery ||
          provHeader ||
          process.env.PUBLIC_HOLIDAYS_PROVIDER ||
          "google"
        ).toLowerCase();
        if (provider === "google") {
          const googleCal = require("../utils/googleCalendarService");
          const countryCal =
            process.env.PUBLIC_HOLIDAYS_CALENDAR_ID ||
            "en.ph#holiday@group.v.calendar.google.com";
          const ph = await googleCal.getHolidaysInRange(
            startDate,
            endDate,
            countryCal,
            process.env.GOOGLE_CALENDAR_API_KEY,
          );
          (ph || []).forEach((h) => {
            blockedSet.add(h.date);
            publicHolidays.push({
              date: h.date,
              name: h.name || h.summary || "",
            });
          });
        } else if (provider === "nager") {
          const nager = require("../utils/nagerDateService");
          const country = (
            req.query.country ||
            process.env.NAGER_COUNTRY ||
            "PH"
          ).toUpperCase();
          const startYr = startDate.getFullYear();
          const endYr = endDate.getFullYear();
          for (let yr = startYr; yr <= endYr; yr++) {
            try {
              const phs = await nager.getPublicHolidays(country, yr);
              (phs || []).forEach((h) => {
                if (h && h.date) {
                  blockedSet.add(h.date);
                  publicHolidays.push({
                    date: h.date,
                    name: h.localName || h.name || "",
                  });
                }
              });
            } catch (err) {
              console.warn(
                "calendar: failed to fetch nager holidays",
                err && err.message,
              );
            }
          }
        }
      }
      return res.json({
        bookedDates: Array.from(bookedSet),
        blockedDates: Array.from(blockedSet),
        publicHolidays,
        nonWorkingDays,
      });
    } catch (e) {
      console.warn(
        "calendar: failed to include public holidays",
        e && e.message,
      );
      return res.json({
        bookedDates: Array.from(bookedSet),
        blockedDates: Array.from(blockedSet),
        nonWorkingDays,
      });
    }
  } catch (err) {
    console.error("GET /api/services/:id/calendar failed", err && err.message);
    return res.status(500).json({ error: "failed to load calendar data" });
  }
});

// GET /api/services/fare-per-km — public endpoint so the booking UI can
// display the correct fare rate configured by the admin.
router.get("/fare-per-km", async (req, res) => {
  try {
    const SiteSetting = require("../models/SiteSetting");
    const setting = await SiteSetting.findOne({ key: "farePerKm" }).lean();
    const farePerKm =
      setting && typeof setting.value === "number" ? setting.value : 40;
    return res.json({ farePerKm });
  } catch (err) {
    return res.json({ farePerKm: 40 });
  }
});

module.exports = router;

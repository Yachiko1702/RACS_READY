const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema({
  // keep a reference to the user and technician so we can still run joins/query
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  technicianId: { type: mongoose.Schema.Types.ObjectId, ref: "Technician" },

  // snapshots of the customer/technician info at the time of booking
  // this allows us to show the name/contact even if either account is later
  customer: {
    _id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    name: String,
    email: String,
    phone: String,
    address: String,
  },

  technician: {
    _id: { type: mongoose.Schema.Types.ObjectId, ref: "Technician" },
    name: String,
    phone: String,
    email: String,
    // additional fields can be added (eg. speciality) if needed
  },

  // reference to either a CoreService or RepairService document.
  // `serviceModel` is automatically derived from `serviceType` so that
  // mongoose can use `refPath` to populate the proper collection.
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: "serviceModel",
  },

  serviceModel: {
    type: String,
    enum: ["CoreService", "RepairService"],
  },

  // snapshot of the service chosen (for display even if service doc changes)
  service: {
    _id: { type: mongoose.Schema.Types.ObjectId, refPath: "serviceModel" },
    name: String,
    description: String,
    basePrice: Number,
    // additional fields can be added as required (icon, category, etc.)
  },
  servicePrice: { type: Number }, // snapshot of cost at booking time
  serviceDurationMinutes: { type: Number },

  // estimated fee (servicePrice + travel fare) stored when booking created
  estimatedFee: { type: Number },
  travelFare: { type: Number },
  travelTime: { type: Number }, // minutes estimated from technician to customer

  // when booking a repair, user can describe the issue they are facing
  issueDescription: { type: String },

  // optional image associated with this booking (e.g. photo of issue or location)
  imageUrl: { type: String },

  bookingDate: { type: Date, required: true },
  startTime: { type: String },
  endTime: { type: String },
  selectedTimeLabel: { type: String }, // exact slot text selected by customer in services.ejs

  status: {
    type: String,
    enum: ["pending", "confirmed", "completed", "cancelled", "re-scheduled"],
    default: "pending",
  },

  // payment information
  paymentMethod: { type: String, enum: ["cod", "gcash", "paymongo", "cash", "other"], default: "cod" },

  // downpayment / proof information (customer-submitted when booking)
  gcashNumber: { type: String }, // raw mobile number entered by customer (optional reference)
  paymentReference: { type: String }, // text reference or note entered
  downpaymentAmount: { type: Number }, // required for cash bookings
  paymentNotes: { type: String }, // optional special instructions (cash bookings)

  // payment status tracking
  paymentStatus: { type: String, enum: ["pending", "paid", "failed", "partial"], default: "pending" },

  // PayMongo gateway tracking
  paymentGatewayId: { type: String },        // PayMongo source / payment ID
  paymentGatewayStatus: { type: String },    // raw status from PayMongo

  // legacy fields kept for backwards compatibility
  paymentProof: { type: String }, // base64 data URL or URL to uploaded proof image
  gateway: { type: String, enum: ["paymongo", "other"] },
  gatewayId: String,
  gatewayStatus: String,

  location: {
    address: String,
    coordinates: {
      type: { type: String, default: "Point" },
      coordinates: [Number],
    },
  },
  technicianLocation: {
    address: String,
    coordinates: {
      type: { type: String, default: "Point" },
      coordinates: [Number],
    },
  },

  // Google Calendar sync metadata (server-side)
  googleCalendarId: { type: String },
  googleCalendarEventId: { type: String },
  googleCalendarHtmlLink: { type: String },

  // human-readable unique booking reference (e.g. RACS-20260301-AB3X)
  bookingReference: { type: String, unique: true, sparse: true },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date },
});

// virtual helpers for views/queries
bookingSchema.virtual("customerName").get(function () {
  if (this.customer && this.customer.name) return this.customer.name;
  return undefined;
});
bookingSchema.virtual("customerEmail").get(function () {
  if (this.customer && this.customer.email) return this.customer.email;
  return undefined;
});
bookingSchema.virtual("technicianName").get(function () {
  // prefer stored snapshot
  if (this.technician && this.technician.name) return this.technician.name;
  // if the document was populated and the referenced technician/user object
  // includes a name property, use that too (allows populate("technicianId")).
  if (this.technicianId && typeof this.technicianId === "object") {
    if (this.technicianId.name) return this.technicianId.name;
    if (this.technicianId.fullName) return this.technicianId.fullName;
    if (this.technicianId.firstName || this.technicianId.lastName) {
      return (
        (this.technicianId.firstName || "") +
        " " +
        (this.technicianId.lastName || "")
      ).trim();
    }
  }
  return undefined;
});
// helpers that expose the chosen service information when serviceId has been populated
bookingSchema.virtual("serviceName").get(function () {
  if (this.service && this.service.name) return this.service.name;
  if (this.serviceId && this.serviceId.name) return this.serviceId.name;
  return undefined;
});
bookingSchema.virtual("serviceDescription").get(function () {
  if (this.service && this.service.description) return this.service.description;
  if (this.serviceId && this.serviceId.description) return this.serviceId.description;
  return undefined;
});

// make sure virtuals are included when converting to objects/json
bookingSchema.set("toObject", { virtuals: true });
bookingSchema.set("toJSON", { virtuals: true });

// keep updatedAt in sync and maintain serviceModel based on serviceType
// also populate/refresh customer/technician snapshots if ids are provided
bookingSchema.pre("save", async function () {
  // map old simple type to actual model name used for refPath
  if (this.serviceType === "core") this.serviceModel = "CoreService";
  else if (this.serviceType === "repair") this.serviceModel = "RepairService";

  // if user switches category away from repair, clear any entered issue
  if (this.serviceType !== "repair") this.issueDescription = undefined;

  // snapshot customer information if we have an id but no details yet
  if (this.customerId && (!this.customer || !this.customer._id)) {
    try {
      const User = mongoose.model("User");
      const u = await User.findById(this.customerId).lean();
      if (u) {
        this.customer = {
          _id: u._id,
          name: u.name || u.fullName || "",
          email: u.email || "",
          phone: u.phone || u.mobile || "",
          address: u.address || "",
        };
      }
    } catch (e) {
      // fail silently – booking should still save
    }
  }
  // snapshot chosen service info if we have a reference and no snapshot yet
  if (this.serviceId && (!this.service || !this.service._id)) {
    try {
      // serviceModel should already be set (pre-save earlier)
      const Model = mongoose.model(this.serviceModel || "CoreService");
      const svc = await Model.findById(this.serviceId).lean();
      if (svc) {
        this.service = {
          _id: svc._id,
          name: svc.name || svc.title || "",
          description: svc.description || svc.commonFaults || "",
          basePrice: svc.basePrice || svc.laborPerHour || 0,
        };
        // also cache price and (approx) duration
        if (svc.basePrice !== undefined) this.servicePrice = svc.basePrice;
        if (svc.durationMinutes !== undefined)
          this.serviceDurationMinutes = svc.durationMinutes;
        else if (svc.estimatedDurationMinutes !== undefined)
          this.serviceDurationMinutes = svc.estimatedDurationMinutes;
      }
    } catch (e) {
      /* ignore snapshot failure */
    }
  }
  // if travelFare exists, recalc estimated fee after servicePrice set
  if (this.travelFare != null) {
    const base = this.servicePrice || (this.service && this.service.basePrice) || 0;
    this.estimatedFee = base + (this.travelFare || 0);
  }
  // snapshot technician information when set
  if (this.technicianId && (!this.technician || !this.technician._id)) {
    try {
      const Technician = mongoose.model("Technician");
      let t = await Technician.findById(this.technicianId).lean();
      if (!t) {
        // maybe we were given a user account id instead
        const User = mongoose.model("User");
        const u = await User.findById(this.technicianId).lean();
        if (u) {
          t = {
            _id: u._id,
            name: u.name || u.fullName || ((u.firstName || "") + " " + (u.lastName || "")).trim(),
            email: u.email || u.userEmail || "",
            phone: u.phone || "",
          };
        }
      }
      if (t) {
        this.technician = {
          _id: t._id,
          name: t.name || t.fullName || "",
          email: t.email || "",
          phone: t.phone || t.mobile || "",
        };
      }
    } catch (e) {
      // ignore
    }
  }

  this.updatedAt = new Date();
});

module.exports = mongoose.model("BookingService", bookingSchema);

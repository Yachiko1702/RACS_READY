const mongoose = require("mongoose");

const technicianSchema = new mongoose.Schema({
  // link to the User account when this technician also has a staff/user record
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    index: true,
    unique: true,
    sparse: true,
  },
  // denormalized contact fields for quick access
  userEmail: { type: String, trim: true, lowercase: true, index: true },
  phone: { type: String, trim: true },

  // public-facing technician name (fallback when no linked User exists)
  name: { type: String, required: true },
  // `skills` removed: technician/service matching is handled via Service/Booking models
  active: { type: Boolean, default: true },

  // Scheduling moved to `TechnicianSchedule`.
  // Keep this model lean; scheduling data is stored in TechnicianSchedule documents.

  location: {
    type: { type: String, default: "Point" },
    coordinates: { type: [Number], index: "2dsphere" }, // [lng, lat]
  },
  // human-readable location/address when precise coordinates are not provided
  locationText: { type: String, trim: true },

  createdAt: { type: Date, default: Date.now },
});

// helper static functions for common queries
technicianSchema.statics.getActiveWithLocation = function () {
  // returns active technicians that have a location coordinate set
  return this.find({
    active: true,
    "location.coordinates.1": { $exists: true },
  });
};

technicianSchema.statics.updateLocation = function (techId, lng, lat) {
  // convenience method for updating coordinates easily
  return this.findByIdAndUpdate(
    techId,
    { location: { type: "Point", coordinates: [lng, lat] } },
    { new: true },
  );
};

// NOTE: `user` path already declares `unique: true, sparse: true` above —
// removing duplicate schema.index to avoid Mongoose warning about duplicate indexes.

module.exports = mongoose.model("Technician", technicianSchema);

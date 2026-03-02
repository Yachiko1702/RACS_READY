const mongoose = require('mongoose');

const partSchema = new mongoose.Schema({
  name: { type: String, required: true },
  partNumber: { type: String },
  price: { type: Number },
  quantity: { type: Number, default: 1 },
  required: { type: Boolean, default: false }
}, { _id: false });

const repairServiceSchema = new mongoose.Schema({
  name: { type: String, required: true, index: true },
  icon: { type: String },
  applianceType: { type: String, index: true },
  commonFaults: [String],
  parts: [partSchema],
  basePrice: { type: Number },
  laborPerHour: { type: Number },
  estimatedDurationMinutes: { type: Number },
  durationRange: {
    min: { type: Number },
    max: { type: Number }
  },
  warrantyDays: { type: Number, default: 0 },
  availabilityLocations: [String],
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date }
});

// use modern (sync/async) middleware signature — do not accept `next`
repairServiceSchema.pre('save', function () {
  this.updatedAt = new Date();
});

module.exports = mongoose.model('RepairService', repairServiceSchema);

const mongoose = require('mongoose');

const coreServiceSchema = new mongoose.Schema({
  name: { type: String, required: true, index: true },
  slug: { type: String, required: true, unique: true, index: true },
  category: { type: String, required: true, index: true },
  description: { type: String },
  features: [String],
  includedItems: [String],
  exclusions: [String],
  images: [String],
  basePrice: { type: Number },
  priceRange: {
    min: { type: Number },
    max: { type: Number }
  },
  durationMinutes: { type: Number },
  durationRange: {
    min: { type: Number },
    max: { type: Number }
  },
  tags: [String],
  active: { type: Boolean, default: true },
  meta: {
    title: { type: String },
    description: { type: String }
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date }
});

// use modern (sync/async) middleware signature — don't accept `next` and call it
coreServiceSchema.pre('save', function () {
  this.updatedAt = new Date();
});

module.exports = mongoose.model('CoreService', coreServiceSchema);

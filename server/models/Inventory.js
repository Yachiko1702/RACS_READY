const mongoose = require("mongoose");

const inventorySchema = new mongoose.Schema(
  {
    itemName: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    // optional globally-unique barcode / SKU
    // `sparse: true` allows existing records without a barcode
    barcode: {
      type: String,
      trim: true,
      index: true,
      unique: true,
      sparse: true,
    },

    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
      index: true,
    },

    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      default: null,
      index: true,
    },

    variant: {
      type: String,
      default: null,
    },

    size: {
      type: String,
      default: null,
    },

    specification: {
      type: String,
      default: null,
    },

    unit: {
      type: String,
      default: "pcs",
    },

    quantity: {
      type: Number,
      default: 0,
      min: 0,
    },

    minStockLevel: {
      type: Number,
      default: 5, // alert threshold
    },

    costPrice: {
      type: Number,
      default: 0,
      min: 0,
    },

    sellingPrice: {
      type: Number,
      default: 0,
      min: 0,
    },

    supplier: {
      type: String,
      default: null,
    },

    isStockItem: {
      type: Boolean,
      default: true,
    },

    // determine where this item is intended to be sold
    // 'web' = website only (e.g. aircon units),
    // 'shop' = in-store/POS only, 'both' = available everywhere
    salesChannel: {
      type: String,
      enum: ["web", "shop", "both"],
      default: "shop",
      index: true,
    },

    active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

// auto-generate a barcode for new Inventory documents when missing
inventorySchema.pre("save", async function () {
  if (!this.barcode) {
    const base = `INV${this._id.toString().slice(-8).toUpperCase()}`;
    let candidate = base;
    let suffix = 0;
    // ensure uniqueness (avoid race in high-concurrency environments)
    while (await mongoose.models.Inventory.findOne({ barcode: candidate })) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    this.barcode = candidate;
  }
});

module.exports = mongoose.model("Inventory", inventorySchema);

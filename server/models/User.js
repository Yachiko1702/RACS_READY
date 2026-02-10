const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['customer', 'admin', 'technician'], default: 'customer' },
  createdAt: { type: Date, default: Date.now },
  lastLogin: Date,
  resetPasswordTokenHash: String,
  resetPasswordExpires: Date,
  lastPasswordChange: Date
});

// Create a reset token (unhashed token returned, hashed version stored)
// Create a reset token (unhashed token returned, hashed version stored)
userSchema.methods.createPasswordResetToken = function () {
  const token = require('crypto').randomBytes(32).toString('hex');
  const hash = require('crypto').createHash('sha256').update(token).digest('hex');
  this.resetPasswordTokenHash = hash;
  this.resetPasswordExpires = Date.now() + (60 * 60 * 1000); // 1 hour
  return token;
};

userSchema.methods.clearPasswordReset = function () {
  this.resetPasswordTokenHash = undefined;
  this.resetPasswordExpires = undefined;
};

userSchema.methods.setPassword = async function (password) {
  const saltRounds = 12;
  this.passwordHash = await bcrypt.hash(password, saltRounds);
  this.lastPasswordChange = new Date();
};

// Compare provided password with stored hash
userSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

// Hide sensitive fields when converting to JSON
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  delete obj.resetPasswordTokenHash;
  return obj;
};

module.exports = mongoose.model('User', userSchema);

userSchema.methods.clearPasswordReset = function () {
  this.resetPasswordTokenHash = undefined;
  this.resetPasswordExpires = undefined;
};

userSchema.methods.setPassword = async function (password) {
  const saltRounds = 12;
  this.passwordHash = await bcrypt.hash(password, saltRounds);
  this.lastPasswordChange = new Date();
};

// Compare provided password with stored hash
userSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

// Hide sensitive fields when converting to JSON
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  delete obj.resetPasswordTokenHash;
  return obj;
};

module.exports = mongoose.model('User', userSchema);

// Set a password (hash with bcrypt)
userSchema.methods.setPassword = async function (password) {
  const saltRounds = 12;
  this.passwordHash = await bcrypt.hash(password, saltRounds);
};

// Compare provided password with stored hash
userSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

// Hide sensitive fields when converting to JSON
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  return obj;
};

module.exports = mongoose.model('User', userSchema);

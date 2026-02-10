/**
 * Simple seed script to create a test user for development.
 * Usage: NODE_ENV=development node server/scripts/seedUser.js
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/appointment_scheduler';

async function run() {
  await mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected to MongoDB');

  const testEmail = process.env.SEED_TEST_EMAIL || 'test@example.com';
  const testPassword = process.env.SEED_TEST_PASSWORD || 'Password123!';

  let user = await User.findOne({ email: testEmail });
  if (user) {
    console.log('User already exists:', testEmail);
  } else {
    user = new User({ email: testEmail });
    await user.setPassword(testPassword);
    await user.save();
    console.log('Created user:', testEmail);
  }

  console.log('You can now test the password reset flow by calling /forgot-password for this email.');
  console.log(`Credentials -> ${testEmail} / ${testPassword}`);

  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
const express = require('express');
const router = express.Router();
const auth = require('../middleware/authenticate');

// Get all users
router.get('/', (req, res) => {
  res.json({ message: 'Get all users' });
});

// Get single user (requires authentication)
router.get('/:id', auth.authenticate, async (req, res) => {
  try {
    const User = require('../models/User');
    const u = await User.findById(req.params.id).lean();
    if (!u) return res.status(404).json({ error: 'User not found' });
    // sanitize via model toJSON helper
    const obj = new User(u);
    return res.json(obj.toJSON());
  } catch (err) {
    console.error('user fetch error', err);
    return res.status(500).json({ error: 'failed to load user' });
  }
});

// Create user
router.post('/', (req, res) => {
  res.json({ message: 'Create user' });
});

// Update user
router.put('/:id', (req, res) => {
  res.json({ message: 'Update user', id: req.params.id });
});

// Delete user
router.delete('/:id', (req, res) => {
  res.json({ message: 'Delete user', id: req.params.id });
});

module.exports = router;

const express = require('express');
const router = express.Router();

// Get all appointments
router.get('/', (req, res) => {
  res.json({ message: 'Get all appointments' });
});

// Get single appointment
router.get('/:id', (req, res) => {
  res.json({ message: 'Get appointment by ID', id: req.params.id });
});

// Create appointment
router.post('/', (req, res) => {
  res.json({ message: 'Create appointment' });
});

// Update appointment
router.put('/:id', (req, res) => {
  res.json({ message: 'Update appointment', id: req.params.id });
});

// Delete appointment
router.delete('/:id', (req, res) => {
  res.json({ message: 'Delete appointment', id: req.params.id });
});

module.exports = router;

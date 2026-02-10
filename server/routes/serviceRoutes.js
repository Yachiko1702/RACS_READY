const express = require('express');
const router = express.Router();

// Get all services
router.get('/', (req, res) => {
  res.json({ message: 'Get all services' });
});

// Get single service
router.get('/:id', (req, res) => {
  res.json({ message: 'Get service by ID', id: req.params.id });
});

// Create service
router.post('/', (req, res) => {
  res.json({ message: 'Create service' });
});

// Update service
router.put('/:id', (req, res) => {
  res.json({ message: 'Update service', id: req.params.id });
});

// Delete service
router.delete('/:id', (req, res) => {
  res.json({ message: 'Delete service', id: req.params.id });
});

module.exports = router;

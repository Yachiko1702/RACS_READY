const express = require('express');
const router = express.Router();

// Get all products
router.get('/', (req, res) => {
  res.json({ message: 'Get all products' });
});

// Get single product
router.get('/:id', (req, res) => {
  res.json({ message: 'Get product by ID', id: req.params.id });
});

// Create product
router.post('/', (req, res) => {
  res.json({ message: 'Create product' });
});

// Update product
router.put('/:id', (req, res) => {
  res.json({ message: 'Update product', id: req.params.id });
});

// Delete product
router.delete('/:id', (req, res) => {
  res.json({ message: 'Delete product', id: req.params.id });
});

module.exports = router;

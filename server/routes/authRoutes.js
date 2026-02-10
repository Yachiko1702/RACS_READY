const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController');

// Register - basic customer registration
router.post('/register', [
  body('email').isEmail().normalizeEmail().isLength({ max: 254 }).withMessage('Invalid input').trim(),
  body('password').isLength({ min: 8, max: 128 }).withMessage('Invalid input')
], authController.register);

// Login - CSRF double submit expected (csrfToken) and generic errors
router.post('/login', [
  body('email').isEmail().normalizeEmail().isLength({ max: 254 }).withMessage('Invalid input').trim(),
  body('password').isString().isLength({ min: 8, max: 128 }).withMessage('Invalid input'),
  body('csrfToken').isString().withMessage('Invalid input')
], authController.login);

// Forgot password (generic response)
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail().isLength({ max: 254 }).withMessage('Invalid input').trim(),
  body('csrfToken').optional().isString().withMessage('Invalid input')
], authController.forgotPassword);

// Reset password
router.post('/reset-password', [
  body('token').isString().isLength({ min: 10, max: 256 }).withMessage('Invalid input'),
  body('password').isLength({ min: 8, max: 128 }).withMessage('Invalid input'),
  body('csrfToken').isString().withMessage('Invalid input')
], authController.resetPassword);


// Logout
router.post('/logout', authController.logout);

// Verify token
router.get('/verify', authController.verify);

module.exports = router;

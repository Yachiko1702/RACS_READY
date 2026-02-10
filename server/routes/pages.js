const express = require('express');
const router = express.Router();

const defaultTechnicianLocation = {
  lat: 14.676049,
  lng: 121.043731
};

// Landing page
router.get('/', (req, res) => {
  res.render('pages/landing', { title: 'CALIDRO RACS' });
});

// Services page
router.get('/services', (req, res) => {
  res.render('pages/services', {
    title: 'Our Services',
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    technicianLocation: defaultTechnicianLocation
  });
});

// Products page
router.get('/products', (req, res) => {
  res.render('pages/product', { title: 'Products' });
});

// About page
router.get('/about', (req, res) => {
  res.render('pages/about', { title: 'About Us' });
});

// Contact page
router.get('/contact', (req, res) => {
  res.render('pages/contact', { title: 'Contact Us' });
});

// Login page
const crypto = require('crypto');
router.get('/login', (req, res) => {
  // double-submit CSRF token: set a cookie and pass it into the rendered form
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('XSRF-TOKEN', csrfToken, { httpOnly: false, secure: isProd, sameSite: 'Strict', path: '/' });
  res.render('pages/auth', {
    title: 'Authentication',
    csrfToken,
    error: null,
    registered: req.query.registered || null,
    layout: 'layouts/auth',
    recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || '',
    active: 'sign-in',
    extraStyles: ['/css/auth.css'],
    extraScripts: ['/js/auth-panel.js','/js/auth-common.js', '/js/login.js', '/js/register.js']
  });
});

// Register page (customers only) -> render combined auth panel, prefer sign-up
router.get('/register', (req, res) => {
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('XSRF-TOKEN', csrfToken, { httpOnly: false, secure: isProd, sameSite: 'Strict', path: '/' });
  res.render('pages/auth', {
    title: 'Create an Account',
    csrfToken,
    layout: 'layouts/auth',
    recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || '',
    active: 'sign-up',
    extraStyles: ['/css/auth.css'],
    extraScripts: ['/js/auth-panel.js','/js/auth-common.js', '/js/register.js']
  });
});

// Forgot password page
router.get('/forgot-password', (req, res) => {
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('XSRF-TOKEN', csrfToken, { httpOnly: false, secure: isProd, sameSite: 'Strict', path: '/' });
  res.render('pages/forgot-password', {
    title: 'Forgot your password',
    csrfToken,
    layout: 'layouts/auth',
    recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || '',
    extraScripts: ['/js/forgot.js']
  });
});

// Reset password (token in query)
router.get('/reset-password', (req, res) => {
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('XSRF-TOKEN', csrfToken, { httpOnly: false, secure: isProd, sameSite: 'Strict', path: '/' });
  res.render('pages/reset-password', {
    title: 'Reset your password',
    csrfToken,
    token: req.query.token || '',
    layout: 'layouts/auth',
    recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || '',
    extraScripts: ['/js/reset.js']
  });
});

// EXPORT router
module.exports = router;

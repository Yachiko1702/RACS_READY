const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const path = require('path');
const expressEjsLayouts = require('express-ejs-layouts');
const helmet = require('helmet');


dotenv.config();


const app = express();

// Database connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/appointment_scheduler')
.then(() => console.log('MongoDB connected successfully'))
.catch(err => {
  console.error('MongoDB connection error:', err.message);
  process.exit(1);
});

// Views Engine Setup
app.use(expressEjsLayouts);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layouts/main');

// Helmet Security Middleware - disable default CSP so we can set our own
app.use(helmet({
  contentSecurityPolicy: false
}));

// Hide server information
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.removeHeader('Server');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Content Security Policy - allow CDN resources used by the site
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://maps.googleapis.com https://maps.gstatic.com; " +
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://fonts.googleapis.com https://maps.googleapis.com https://maps.gstatic.com; " +
    "img-src 'self' data: https://cdn.jsdelivr.net https://unpkg.com https://maps.googleapis.com https://maps.gstatic.com; " +
    "connect-src 'self' https://cdn.jsdelivr.net https://unpkg.com https://maps.googleapis.com https://maps.gstatic.com; " +
    "font-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.jsdelivr.net;"
  );
  next();
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Prevent NoSQL injection by sanitizing any keys containing '$' or '.' from request data
const mongoSanitize = require('express-mongo-sanitize');
// Use in-place sanitization to avoid reassigning req.query (which can be a getter-only property in some environments)
app.use(function (req, res, next) {
  try {
    if (req.body && typeof req.body === 'object') mongoSanitize.sanitize(req.body);
    if (req.params && typeof req.params === 'object') mongoSanitize.sanitize(req.params);
    if (req.headers && typeof req.headers === 'object') mongoSanitize.sanitize(req.headers);
    if (req.query && typeof req.query === 'object') mongoSanitize.sanitize(req.query);
  } catch (err) {
    // don't break request flow for sanitization errors
    console.warn('mongo-sanitize failed:', err && err.message);
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Routes
const pageRoutes = require('./routes/pages');
app.use('/', pageRoutes);

// API routes
const productRoutes = require('./routes/productRoutes');
app.use('/api/products', productRoutes);

const serviceRoutes = require('./routes/serviceRoutes');
app.use('/api/services', serviceRoutes);

const appointmentRoutes = require('./routes/appointmentRoutes');
app.use('/api/appointments', appointmentRoutes);

const userRoutes = require('./routes/userRoutes');
app.use('/api/users', userRoutes);

const authRoutes = require('./routes/authRoutes');
app.use('/api/auth', authRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('✓ Server is running');
  console.log(`→ http://localhost:${PORT}`);
});

const { validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const rateLimiter = require('../middleware/loginRateLimiter');

const FAKE_HASH = bcrypt.hashSync('invalid-password', 12);

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').map(c => c.trim()).filter(Boolean).reduce((acc, pair) => {
    const [k, ...v] = pair.split('=');
    acc[k] = decodeURIComponent(v.join('='));
    return acc;
  }, {});
}

function sendGenericError(res, status = 400) {
  // Generic, non-enumerating error message
  return res.status(status).json({ error: 'Invalid email or password. Please try again.' });
}

async function verifyRecaptcha(token, remoteip) {
  // If no secret is configured, skip verification (useful for local/dev)
  const secret = process.env.RECAPTCHA_SECRET;
  if (!secret) return true;
  if (!token) return false;

  try {
    const params = new URLSearchParams();
    params.append('secret', secret);
    params.append('response', token);
    if (remoteip) params.append('remoteip', remoteip);

    const res = await fetch('https://www.google.com/recaptcha/api/siteverify', { method: 'POST', body: params });
    const data = await res.json();
    return !!data.success;
  } catch (e) {
    // If verification fails due to network issues, be conservative and reject
    return false;
  }
}

exports.register = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Registration failed. Please check your input.' });
    }

    // verify captcha
    const recaptchaRes = req.body['g-recaptcha-response'] || '';
    const remoteip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const recaptchaOk = await verifyRecaptcha(recaptchaRes, remoteip);
    if (!recaptchaOk) {
      return res.status(400).json({ error: 'Registration failed. Please check your input.' });
    }

    // Basic server-side sanitization and size checks
    let email = String(req.body.email || '').trim();
    let password = String(req.body.password || '');

    if (!email || !password || email.length > 254 || password.length > 128) {
      return res.status(400).json({ error: 'Registration failed. Please check your input.' });
    }

    // Prevent common NoSQL injection patterns by removing operator chars
    email = email.replace(/[\$\{\}]/g, '');

    const exists = await User.findOne({ email });
    if (exists) {
      // Keep message generic to avoid user enumeration
      return res.status(400).json({ error: 'Registration failed. Please check your input.' });
    }

    const user = new User({ email });
    await user.setPassword(password);
    await user.save();

    // Do not return sensitive info
    res.status(201).json({ message: 'Account created. Please log in.' });
  } catch (err) {
    next(err);
  }
};


// Forgot password - sends single-use token if email exists (response is intentionally generic)
exports.forgotPassword = async (req, res, next) => {
  try {
    let email = String(req.body.email || '').trim();
    const recaptchaRes = req.body['g-recaptcha-response'] || '';
    const remoteip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    // Basic input size check
    if (!email || email.length > 254) {
      return res.status(200).json({ message: 'If an account with that email exists, we have sent a password reset link.' });
    }

    // Prevent common NoSQL injection patterns
    email = email.replace(/[\$\{\}]/g, '');

    // Verify captcha if secret configured
    const recaptchaOk = await verifyRecaptcha(recaptchaRes, remoteip);
    if (!recaptchaOk) {
      // respond generically
      return res.status(200).json({ message: 'If an account with that email exists, we have sent a password reset link.' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      // generic response
      return res.status(200).json({ message: 'If an account with that email exists, we have sent a password reset link.' });
    }

    const token = user.createPasswordResetToken();
    await user.save();

    // Build reset link
    const resetLink = `${req.protocol}://${req.get('host')}/reset-password?token=${token}`;

    // Send email using mailer utility; fail gracefully and stay generic in response
    try {
      const mailer = require('../utils/mailer');
      await mailer.sendResetEmail(email, resetLink);
    } catch (e) {
      console.warn('Failed to send reset email', e && e.message);
      // do not expose failure to the client
    }

    // Send generic response
    return res.status(200).json({ message: 'If an account with that email exists, we have sent a password reset link.' });
  } catch (err) {
    next(err);
  }
};

// Reset password with token
exports.resetPassword = async (req, res, next) => {
  try {
    const { token, password, csrfToken } = req.body;

    // Validate types and sizes early
    if (!token || !password || typeof token !== 'string' || typeof password !== 'string' || token.length > 256 || password.length > 128) return res.status(400).json({ error: 'Reset failed. Please check your input.' });

    // CSRF double-submit check
    const cookies = parseCookies(req);
    const cookieToken = cookies['XSRF-TOKEN'] || '';
    if (!csrfToken || !cookieToken || csrfToken !== cookieToken) {
      return res.status(400).json({ error: 'Reset failed. Please check your input.' });
    }

    const recaptchaRes = req.body['g-recaptcha-response'] || '';
    const remoteip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const recaptchaOk = await verifyRecaptcha(recaptchaRes, remoteip);
    if (!recaptchaOk) return res.status(400).json({ error: 'Reset failed. Please check your input.' });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({ resetPasswordTokenHash: tokenHash, resetPasswordExpires: { $gt: Date.now() } });
    if (!user) return res.status(400).json({ error: 'Reset failed. Please check your input.' });

    await user.setPassword(password);
    user.clearPasswordReset();
    await user.save();

    // Clear any active auth cookies for safety
    res.clearCookie('auth_token', { path: '/' });

    res.json({ message: 'Password reset successful. Please log in.' });
  } catch (err) {
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return sendGenericError(res);
    }

    // CSRF double-submit check
    const cookies = parseCookies(req);
    const sent = req.body.csrfToken || '';
    const cookieToken = cookies['XSRF-TOKEN'] || '';
    if (!sent || !cookieToken || sent !== cookieToken) {
      // Bad token - treat like generic auth failure
      return sendGenericError(res);
    }

    const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    let email = String(req.body.email || '').trim();
    let password = String(req.body.password || '');

    // Basic size checks
    if (!email || !password || email.length > 254 || password.length > 128) {
      return sendGenericError(res);
    }

    // remove operator chars to reduce NoSQL injection risk
    email = email.replace(/[\$\{\}]/g, '');

    // Verify captcha if configured
    const recaptchaRes = req.body['g-recaptcha-response'] || '';
    const recaptchaOk = await verifyRecaptcha(recaptchaRes, ip);
    if (!recaptchaOk) {
      // don't give hints, treat as generic failure
      rateLimiter.recordFailed('ip', ip);
      rateLimiter.recordFailed('email', email);
      return sendGenericError(res);
    }

    // Check block status (by IP and by email)
    const blockedIp = rateLimiter.isBlocked('ip', ip);
    if (blockedIp.blocked) {
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }
    const blockedEmail = rateLimiter.isBlocked('email', email);
    if (blockedEmail.blocked) {
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }

    // Lookup user
    const user = await User.findOne({ email });

    // If user not found, do a fake compare to avoid timing attacks
    let match = false;
    if (!user) {
      // compare to fake hash
      match = await bcrypt.compare(password, FAKE_HASH);
    } else {
      match = await user.comparePassword(password);
    }

    if (!match) {
      // record failed attempts
      rateLimiter.recordFailed('ip', ip);
      rateLimiter.recordFailed('email', email);
      return sendGenericError(res);
    }

    // Success: reset counters
    rateLimiter.reset('ip', ip);
    rateLimiter.reset('email', email);

    // If user has two-factor enabled, generate an OTP and send it, do not complete login yet
    if (user && user.twoFactorEnabled) {
      const code = Math.floor(100000 + Math.random() * 900000);
      await user.setTwoFactorTempCode(code);
      await user.save();
      try {
        const mailer = require('../utils/mailer');
        await mailer.sendOtpEmail(email, code);
      } catch (e) {
        console.warn('Failed to send OTP for 2FA', e && e.message);
      }
      return res.status(202).json({ message: 'otp_sent' });
    }

    // Update last login
    if (user) {
      user.lastLogin = new Date();
      await user.save();
    }

    const payload = { id: user._id, role: user.role };
    const token = jwt.sign(payload, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '7d' });

    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'Strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });

    // Role based redirect (example)
    if (user.role === 'admin') return res.json({ message: 'ok', redirect: '/admin' });
    if (user.role === 'technician') return res.json({ message: 'ok', redirect: '/technician' });

    return res.json({ message: 'ok', redirect: '/services' });
  } catch (err) {
    next(err);
  }
};

exports.logout = async (req, res) => {
  res.clearCookie('auth_token', { path: '/' });
  res.json({ message: 'Logged out' });
};

exports.verify = async (req, res) => {
  try {
    const cookies = parseCookies(req);
    const token = cookies['auth_token'];
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    const user = await User.findById(payload.id).select('-passwordHash');
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    res.json({ user });
  } catch (err) {
    res.status(401).json({ error: 'Not authenticated' });
  }
};

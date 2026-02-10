const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
// If token will expire in less than this threshold we issue a new one (sliding session)
const ROTATE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function parseCookies(header) {
  const h = header || '';
  return h.split(';').map(c => c.trim()).filter(Boolean).reduce((acc, pair) => {
    const [k, ...v] = pair.split('=');
    acc[k] = decodeURIComponent(v.join('='));
    return acc;
  }, {});
}

module.exports = {
  authenticate: async function (req, res, next) {
    try {
      const cookies = parseCookies(req.headers.cookie || '');
      const token = cookies['auth_token'];
      if (!token) return res.status(401).json({ error: 'Not authenticated' });

      let payload;
      try {
        payload = jwt.verify(token, JWT_SECRET);
      } catch (e) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // attach basic user info
      const user = await User.findById(payload.id).select('-passwordHash');
      if (!user) return res.status(401).json({ error: 'Not authenticated' });

      // If the user's password was changed after token was issued, reject the token
      if (user.lastPasswordChange && payload.iat && (payload.iat * 1000) < user.lastPasswordChange.getTime()) {
        // clear cookie
        res.clearCookie('auth_token', { path: '/' });
        return res.status(401).json({ error: 'Not authenticated' });
      }

      req.user = user;

      // sliding session: if token expiring soon, issue a rotated token
      const expMs = (payload.exp || 0) * 1000;
      if (expMs - Date.now() < ROTATE_THRESHOLD_MS) {
        const newToken = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        const isProd = process.env.NODE_ENV === 'production';
        res.cookie('auth_token', newToken, {
          httpOnly: true,
          secure: isProd,
          sameSite: 'Strict',
          maxAge: MAX_AGE_MS,
          path: '/'
        });
      }

      next();
    } catch (err) {
      next(err);
    }
  },

  requireRole: function (role) {
    return function (req, res, next) {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (req.user.role !== role) return res.status(403).json({ error: 'Forbidden' });
      next();
    };
  }
};
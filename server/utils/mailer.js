const nodemailer = require('nodemailer');

// Read SMTP config from env
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FROM = process.env.FROM_EMAIL || 'mxwllmallari@gmail.com';

let transporter;

function createTransporter() {
  if (transporter) return transporter;

  // If no SMTP credentials present, keep transporter undefined and let callers handle fallback
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn('Mailer: SMTP credentials not fully configured; emails will not be sent.');
    return null;
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // true for 465, false for other ports
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });

  // optionally verify connection on startup
  transporter.verify().then(() => {
    console.log('Mailer: SMTP connection verified');
  }).catch(err => {
    console.warn('Mailer: SMTP verification failed', err && err.message);
  });

  return transporter;
}

async function sendMail({ to, subject, html, text }) {
  const t = createTransporter();
  if (!t) {
    console.log('Mailer [dev]: email would be sent to', to, 'subject:', subject);
    console.log('Mailer [dev]: html:\n', html);
    return false;
  }

  const info = await t.sendMail({ from: FROM, to, subject, html, text });
  return info;
}

async function sendResetEmail(to, resetLink) {
  const subject = 'Password reset for CALIDRO RACS';
  const html = `<p>Hello,</p>
  <p>We received a request to reset your password. If it was you, click the link below to reset your password (valid for 1 hour):</p>
  <p><a href="${resetLink}">Reset your password</a></p>
  <p>If you did not request this, you can safely ignore this email.</p>
  <p>— CALIDRO RACS</p>`;
  const text = `Reset your password: ${resetLink}`;
  return sendMail({ to, subject, html, text });
}

module.exports = { sendMail, sendResetEmail };

module.exports = { sendMail, sendResetEmail };

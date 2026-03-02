require('dotenv').config();
const mailer = require('../utils/mailer');

(async () => {
  console.log('SMTP config:', process.env.SMTP_HOST, process.env.SMTP_PORT, process.env.SMTP_USER ? 'user set' : 'no user');
  try {
    const info = await mailer.sendMail({
      to: process.env.SMTP_USER,
      subject: 'CALIDRO RACS — SMTP test',
      text: 'This is a test email from the CALIDRO RACS project.',
      html: '<p>This is a <strong>test</strong> email from the CALIDRO RACS project.</p>'
    });
    console.log('Mailer send result:', info);
  } catch (err) {
    console.error('Mailer send error:', err && err.message ? err.message : err);
    console.error(err);
  }
})();
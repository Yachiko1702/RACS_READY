const nodemailer = require("nodemailer");

// Read SMTP config from env
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = process.env.SMTP_PORT
  ? parseInt(process.env.SMTP_PORT, 10)
  : 587;
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const FROM = process.env.FROM_EMAIL || "mxwllmallari@gmail.com";

let transporter;

function createTransporter() {
  if (transporter) return transporter;

  // If no SMTP credentials present, keep transporter undefined and let callers handle fallback
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn(
      "Mailer: SMTP credentials not fully configured; emails will not be sent.",
    );
    return null;
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // true for 465, false for other ports
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  // optionally verify connection on startup
  transporter
    .verify()
    .then(() => {
      console.log("Mailer: SMTP connection verified");
    })
    .catch((err) => {
      console.warn("Mailer: SMTP verification failed", err && err.message);
    });

  return transporter;
}

async function sendMail({ to, subject, html, text }) {
  const t = createTransporter();
  if (!t) {
    console.log(
      "Mailer [dev]: email would be sent to",
      to,
      "subject:",
      subject,
    );
    console.log("Mailer [dev]: html:\n", html);
    return false;
  }

  const info = await t.sendMail({ from: FROM, to, subject, html, text });
  return info;
}

// ─── Booking Confirmation Email (to customer) ───────────────────────────────
async function sendBookingConfirmationEmail({
  to, customerName, bookingReference, serviceName,
  dateLabel, timeLabel, totalLabel,
  paymentMethod, estimatedFee, locationAddress,
  issueDescription, travelMins, serviceDuration,
}) {
  const subject = `Booking Confirmed – ${bookingReference} | CALIDRO RACS`;
  const feeDisplay = estimatedFee ? `₱${Number(estimatedFee).toFixed(2)}` : "To be confirmed";
  const payLabel   = paymentMethod === "gcash" ? "GCash" : "Cash on Delivery";
  const durationHr = serviceDuration >= 60
    ? `${Math.floor(serviceDuration/60)}h${serviceDuration%60?` ${serviceDuration%60}m`:""}` 
    : `${serviceDuration}m`;
  const travelLine = travelMins > 0 ? `
      <tr><td style="padding:6px 0;color:#6c757d;">Travel time</td><td style="padding:6px 0;font-weight:600;">${travelMins} min</td></tr>` : "";
  const issueLine = issueDescription ? `
      <tr><td style="padding:6px 0;color:#6c757d;">Issue described</td><td style="padding:6px 0;">${issueDescription}</td></tr>` : "";
  const html = `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<style>body{margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;}
.wrap{max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);}
.header{background:linear-gradient(135deg,#0d6efd,#0a58ca);padding:36px 32px;text-align:center;color:#fff;}
.header h1{margin:0;font-size:22px;letter-spacing:.5px;}
.ref-badge{display:inline-block;margin-top:12px;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4);color:#fff;font-size:18px;font-weight:700;letter-spacing:2px;padding:8px 20px;border-radius:8px;}
.body{padding:32px;}
.status-pill{display:inline-block;background:#fff8e1;border:1px solid #ffd54f;color:#e65100;font-size:12px;font-weight:700;padding:4px 14px;border-radius:20px;margin-bottom:20px;}
 table{width:100%;border-collapse:collapse;}
td{vertical-align:top;font-size:14px;}
.section-title{font-size:13px;font-weight:700;color:#0d6efd;text-transform:uppercase;letter-spacing:.8px;margin:24px 0 10px;border-bottom:2px solid #e9ecef;padding-bottom:6px;}
.footer{background:#f8f9fa;padding:20px 32px;text-align:center;font-size:12px;color:#6c757d;}
.btn{display:inline-block;margin-top:20px;padding:12px 28px;background:#0d6efd;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;}
</style></head><body>
<div class="wrap">
  <div class="header">
    <h1>🔧 CALIDRO RACS</h1>
    <p style="margin:8px 0 4px;opacity:.85;">Booking Request Received</p>
    <div class="ref-badge">${bookingReference}</div>
  </div>
  <div class="body">
    <p>Hi <strong>${customerName}</strong>,</p>
    <p>Thank you for booking with CALIDRO RACS! Your request has been submitted and is currently <strong>pending confirmation</strong> by our team. You will receive another notification once it is confirmed.</p>
    <span class="status-pill">⏳ PENDING CONFIRMATION</span>

    <div class="section-title">Booking Details</div>
    <table>
      <tr><td style="padding:6px 0;color:#6c757d;">Reference</td><td style="padding:6px 0;font-weight:700;color:#0d6efd;">${bookingReference}</td></tr>
      <tr><td style="padding:6px 0;color:#6c757d;">Service</td><td style="padding:6px 0;font-weight:600;">${serviceName}</td></tr>
      <tr><td style="padding:6px 0;color:#6c757d;">Date</td><td style="padding:6px 0;">${dateLabel}</td></tr>
      <tr><td style="padding:6px 0;color:#6c757d;">Arrival window</td><td style="padding:6px 0;">${timeLabel}</td></tr>
      <tr><td style="padding:6px 0;color:#6c757d;">Service duration</td><td style="padding:6px 0;">${durationHr}</td></tr>
      ${travelLine}
      <tr><td style="padding:6px 0;color:#6c757d;">Full block</td><td style="padding:6px 0;">${totalLabel}</td></tr>
      ${locationAddress ? `<tr><td style="padding:6px 0;color:#6c757d;">Location</td><td style="padding:6px 0;">${locationAddress}</td></tr>` : ""}
      ${issueLine}
    </table>

    <div class="section-title">Payment</div>
    <table>
      <tr><td style="padding:6px 0;color:#6c757d;">Method</td><td style="padding:6px 0;">${payLabel}</td></tr>
      <tr><td style="padding:6px 0;color:#6c757d;">Estimated Fee</td><td style="padding:6px 0;font-weight:700;color:#198754;">${feeDisplay}</td></tr>
    </table>

    <p style="margin-top:24px;font-size:13px;color:#6c757d;">If you need to cancel or reschedule, please contact us at least 24 hours before your appointment.</p>
    <a href="/book-history" class="btn">View My Bookings</a>
  </div>
  <div class="footer">CALIDRO Refrigeration &amp; Air-Conditioning Services · Philippines<br>This is an automated message — please do not reply directly.</div>
</div>
</body></html>`;
  return sendMail({ to, subject, html });
}

// ─── Technician New-Job Notification Email ───────────────────────────────────
async function sendTechnicianNotificationEmail({
  to, technicianName, customerName, bookingReference,
  serviceName, dateLabel, timeLabel, totalLabel,
  locationAddress, issueDescription,
}) {
  const subject = `New Booking Assigned – ${bookingReference} | CALIDRO RACS`;
  const issueLine = issueDescription ? `
      <tr><td style="padding:6px 0;color:#6c757d;">Issue</td><td style="padding:6px 0;">${issueDescription}</td></tr>` : "";
  const html = `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<style>body{margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;}
.wrap{max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);}
.header{background:linear-gradient(135deg,#198754,#0f5132);padding:36px 32px;text-align:center;color:#fff;}
.header h1{margin:0;font-size:22px;}
.ref-badge{display:inline-block;margin-top:12px;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4);color:#fff;font-size:16px;font-weight:700;letter-spacing:2px;padding:6px 18px;border-radius:8px;}
.body{padding:32px;}table{width:100%;border-collapse:collapse;}td{vertical-align:top;font-size:14px;}
.section-title{font-size:13px;font-weight:700;color:#198754;text-transform:uppercase;letter-spacing:.8px;margin:24px 0 10px;border-bottom:2px solid #e9ecef;padding-bottom:6px;}
.footer{background:#f8f9fa;padding:20px 32px;text-align:center;font-size:12px;color:#6c757d;}
.btn{display:inline-block;margin-top:20px;padding:12px 28px;background:#198754;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;}
</style></head><body>
<div class="wrap">
  <div class="header">
    <h1>🔧 New Job Assigned</h1>
    <div class="ref-badge">${bookingReference}</div>
  </div>
  <div class="body">
    <p>Hi <strong>${technicianName}</strong>,</p>
    <p>A new booking has been submitted and assigned to you. Please review the details below and prepare accordingly.</p>

    <div class="section-title">Job Details</div>
    <table>
      <tr><td style="padding:6px 0;color:#6c757d;">Reference</td><td style="padding:6px 0;font-weight:700;color:#198754;">${bookingReference}</td></tr>
      <tr><td style="padding:6px 0;color:#6c757d;">Customer</td><td style="padding:6px 0;font-weight:600;">${customerName}</td></tr>
      <tr><td style="padding:6px 0;color:#6c757d;">Service</td><td style="padding:6px 0;">${serviceName}</td></tr>
      <tr><td style="padding:6px 0;color:#6c757d;">Date</td><td style="padding:6px 0;">${dateLabel}</td></tr>
      <tr><td style="padding:6px 0;color:#6c757d;">Arrival window</td><td style="padding:6px 0;">${timeLabel}</td></tr>
      <tr><td style="padding:6px 0;color:#6c757d;">Full block (incl. travel)</td><td style="padding:6px 0;">${totalLabel}</td></tr>
      ${locationAddress ? `<tr><td style="padding:6px 0;color:#6c757d;">Customer location</td><td style="padding:6px 0;">${locationAddress}</td></tr>` : ""}
      ${issueLine}
    </table>

    <p style="margin-top:24px;font-size:13px;color:#6c757d;">Log in to the CALIDRO portal to confirm or update this booking.</p>
    <a href="/technician/appointments" class="btn">Open My Schedule</a>
  </div>
  <div class="footer">CALIDRO Refrigeration &amp; Air-Conditioning Services · Auto-notification</div>
</div>
</body></html>`;
  return sendMail({ to, subject, html });
}

async function sendResetEmail(to, resetLink) {
  const subject = "Password reset for CALIDRO RACS";
  // load expiration from env or default to 5 minutes for display
  const expiryMinutes = Number(process.env.RESET_PASSWORD_TOKEN_EXPIRES_MS)
    ? Math.round(Number(process.env.RESET_PASSWORD_TOKEN_EXPIRES_MS) / 60000)
    : 5;
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Password reset</title>
      <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600&display=swap" rel="stylesheet">
      <style>
        body { margin:0; padding:0; background:#f2f4f6; font-family:'Montserrat',Arial,Helvetica,sans-serif; }
        .container { width:100%; padding:40px 0; }
        .card { max-width:580px; margin:0 auto; background:#ffffff; border:1px solid #e0e0e0; border-radius:8px; overflow:hidden; }
        .header { background:#0d6efd; padding:20px; text-align:center; }
        .header img { max-width:120px; }
        .content { padding:32px 40px; }
        h1 { font-size:24px; color:#333333; margin-top:0; }
        p { font-size:16px; color:#51545e; line-height:1.625; margin:16px 0; }
        .btn { display:inline-block; background:#0d6efd; color:#ffffff; padding:12px 24px; border-radius:6px; text-decoration:none; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; }
        .footer { padding:20px 40px; font-size:12px; color:#a8aaaf; text-align:center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="card">
          <div class="header" style="color:#ffffff; font-size:24px; font-weight:700;">
            CALIDRO RACS
          </div>
          <div class="content">
            <h1>Password Reset Request</h1>
            <p>Hello,</p>
            <p>We received a request to reset your CALIDRO RACS account password. Click the button below to proceed. This link will expire in <strong>${expiryMinutes} minutes</strong>.</p>
            <p style="text-align:center; margin:32px 0;"><a href="${resetLink}" class="btn">Reset Password</a></p>
            <p>If you did not make this request, you can safely ignore this message. Your password will remain unchanged.</p>
            <p>Best regards,<br>CALIDRO RACS Team</p>
          </div>
          <div class="footer">
            &copy; ${new Date().getFullYear()} CALIDRO RACS. All rights reserved.
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
  const text = `Reset your password: ${resetLink} (expires in ${expiryMinutes} minutes)`;
  return sendMail({ to, subject, html, text });
}

module.exports = { sendMail, sendResetEmail, sendBookingConfirmationEmail, sendTechnicianNotificationEmail };

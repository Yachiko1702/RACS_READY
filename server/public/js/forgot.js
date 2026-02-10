document.addEventListener('DOMContentLoaded', function () {
  var form = document.getElementById('forgotForm') || document.getElementById('forgot-form');
  var alertEl = document.getElementById('forgotAlert');
  var btn = document.getElementById('forgotBtn');
  if (!form) return;

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    alertEl.classList.add('d-none');

    var formData = new FormData(form);
    var email = (formData.get('email') || formData.get('forgot-email')) || '';
    var csrfToken = formData.get('csrfToken') || ''; 

    email = String(email).trim();
    if (!email) return window.authUtils.swalError('Missing information', 'Please enter your email address.');
    if (email.length > 254) return window.authUtils.swalError('Invalid email', 'Email is too long.');
    if (!window.authUtils.validateEmail(email)) return window.authUtils.swalError('Invalid email', 'Please enter a valid email address.');

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Sending...';

    var recaptchaWidgetPresent = document.querySelector('.g-recaptcha') !== null;
    var recaptcha = (window.grecaptcha && typeof grecaptcha.getResponse === 'function') ? grecaptcha.getResponse() : '';

    if (recaptchaWidgetPresent && !recaptcha) {
      btn.disabled = false;
      btn.innerText = 'Send Reset Link';
      return window.authUtils.swalError('CAPTCHA required', 'Please complete the CAPTCHA to continue.');
    }

    fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, csrfToken: csrfToken, 'g-recaptcha-response': recaptcha })
    })
    .then(function (res) { return res.json().then(function (body) { return { status: res.status, body: body }; }); })
    .then(function () {
      // Generic success message for privacy
      window.authUtils.swalSuccess('Request received', 'If an account with that email exists, we have sent a password reset link.');
      if (window.grecaptcha && typeof grecaptcha.reset === 'function') grecaptcha.reset();
    })
    .catch(function () {
      window.authUtils.swalSuccess('Request received', 'If an account with that email exists, we have sent a password reset link.');
    })
    .finally(function () {
      btn.disabled = false;
      btn.innerText = 'Send Reset Link';
    });
  });
});
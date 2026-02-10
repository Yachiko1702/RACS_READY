document.addEventListener('DOMContentLoaded', function () {
  var form = document.getElementById('auth-login-form');
  if (!form) return;

  var btn = form.querySelector('button[type="submit"]');

  // Password visibility toggle: accessible helper
  function setupToggle(toggleEl, inputId) {
    if (!toggleEl) return;
    toggleEl.addEventListener('click', function () {
      var el = document.getElementById(inputId);
      if (!el) return;
      var isPwd = el.getAttribute('type') === 'password';
      var type = isPwd ? 'text' : 'password';
      el.setAttribute('type', type);
      this.innerHTML = isPwd ? '<i class="bi bi-eye-slash"></i>' : '<i class="bi bi-eye"></i>';
      this.setAttribute('aria-pressed', isPwd ? 'true' : 'false');
      this.setAttribute('aria-label', isPwd ? 'Hide password' : 'Show password');
    });
  }
  setupToggle(document.getElementById('togglePassword'), 'password');

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var email = (form.querySelector('#email') || {}).value || '';
    var password = (form.querySelector('#password') || {}).value || '';
    var csrfToken = (form.querySelector('input[name="csrfToken"]') || {}).value || '';

    // Basic client validation
    if (!email || !password) {
      return window.authUtils.swalError('Missing information', 'Please enter both email and password.');
    }

    if (!window.authUtils.validateEmail(email)) {
      return window.authUtils.swalError('Invalid email', 'Please enter a valid email address.');
    }

    // Recaptcha (if present) — require completion when widget is on the page
    var recaptchaWidgetPresent = document.querySelector('.g-recaptcha') !== null;
    var recaptcha = (window.grecaptcha && typeof grecaptcha.getResponse === 'function') ? grecaptcha.getResponse() : '';
    if (recaptchaWidgetPresent && !recaptcha) {
      return window.authUtils.swalError('CAPTCHA required', 'Please complete the CAPTCHA to continue.');
    }

    // Disable UI
    btn.disabled = true;
    var previousText = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Signing in...';

    fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password, csrfToken: csrfToken, 'g-recaptcha-response': recaptcha })
    })
    .then(function (res) { return res.json().then(function (body) { return { status: res.status, body: body }; }); })
    .then(function (result) {
      if (result.status === 200 && result.body && result.body.redirect) {
        // On success, redirect to server-provided route
        window.location.assign(result.body.redirect);
      } else if (result.status === 429) {
        window.authUtils.swalError('Too many attempts', 'Too many login attempts. Please try again later.');
      } else {
        // Generic auth failure
        window.authUtils.swalError('Login failed', 'Invalid email or password. Please try again.');
        // Reset recaptcha if present
        if (window.grecaptcha && typeof grecaptcha.reset === 'function') grecaptcha.reset();
      }
    })
    .catch(function () {
      window.authUtils.swalError('Network error', 'Unable to reach the server. Please try again later.');
    })
    .finally(function () {
      btn.disabled = false;
      btn.innerHTML = previousText;
    });
  });

  // Show success toast if registered recently
  var params = new URLSearchParams(window.location.search);
  if (params.get('registered')) {
    window.authUtils.swalSuccess('Account created', 'Your account was created successfully. Please log in.');
  }
});
document.addEventListener('DOMContentLoaded', function () {
  var form = document.getElementById('auth-register-form') || document.getElementById('registerForm');
  var alertEl = document.getElementById('registerAlert');
  var btn = document.getElementById('registerBtn');

  if (!form) return;

  // Password visibility toggles
  var toggle = document.getElementById('togglePasswordReg');
  var toggleConfirm = document.getElementById('toggleConfirmPasswordReg');
  function setupToggle(toggleEl, inputId) {
    if (!toggleEl) return;
    toggleEl.addEventListener('click', function () {
      var el = document.getElementById(inputId);
      if (!el) return;
      var type = el.getAttribute('type') === 'password' ? 'text' : 'password';
      el.setAttribute('type', type);
      this.innerHTML = type === 'password' ? '<i class="bi bi-eye"></i>' : '<i class="bi bi-eye-slash"></i>';
    });
  }
  // Attach toggle handlers with fallbacks for both the standalone register page and the combined auth panel
  if (toggle) {
    if (document.getElementById('password')) setupToggle(toggle, 'password');
    else if (document.getElementById('register-password')) setupToggle(toggle, 'register-password');
  }
  if (toggleConfirm) {
    if (document.getElementById('confirmPassword')) setupToggle(toggleConfirm, 'confirmPassword');
    else if (document.getElementById('register-confirm')) setupToggle(toggleConfirm, 'register-confirm');
  }

  if (alertEl) alertEl.classList.add('d-none');
  if (!btn) btn = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    alertEl.classList.add('d-none');

    var formData = new FormData(form);
    var email = formData.get('email') || '';
    var password = formData.get('password') || '';
    var confirm = formData.get('confirmPassword') || '';
    var csrfToken = formData.get('csrfToken') || '';

    // Client-side validation
    if (!email || !password || !confirm) {
      return window.authUtils.swalError('Missing information', 'Please complete all required fields.');
    }

    if (!window.authUtils.validateEmail(email)) {
      return window.authUtils.swalError('Invalid email', 'Please provide a valid email address.');
    }

    if (password.length < 8) {
      return window.authUtils.swalError('Weak password', 'Password must be at least 8 characters long.');
    }

    if (password !== confirm) {
      return window.authUtils.swalError('Passwords do not match', 'Please ensure both password fields match.');
    }

    // store previous label so we can restore
    var previousText = btn ? btn.innerHTML : 'Sign Up';
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Creating...';

    var recaptchaWidgetPresent = document.querySelector('.g-recaptcha') !== null;
    var recaptcha = (window.grecaptcha && typeof grecaptcha.getResponse === 'function') ? grecaptcha.getResponse() : '';

    if (recaptchaWidgetPresent && !recaptcha) {
      btn.disabled = false;
      btn.innerText = 'Create Account';
      return window.authUtils.swalError('CAPTCHA required', 'Please complete the CAPTCHA to continue.');
    }

    fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password, csrfToken: csrfToken, 'g-recaptcha-response': recaptcha })
    })
    .then(function (res) { return res.json().then(function (body) { return { status: res.status, body: body }; }); })
    .then(function (result) {
      if (result.status === 201) {
        window.authUtils.swalSuccess('Account created', 'Your account was created successfully. Redirecting to login...').then(function () {
          window.location.href = '/login?registered=1';
        });
      } else if (result.status === 429) {
        window.authUtils.swalError('Too many attempts', 'Please wait a short while and try again.');
      } else {
        window.authUtils.swalError('Registration failed', 'Registration failed. Please check your input.');
      }
    })
    .catch(function () {
      window.authUtils.swalError('Network error', 'Unable to reach the server. Please try again later.');
    })
    .finally(function () {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = previousText;
      }
    });
  });
});
document.addEventListener('DOMContentLoaded', function () {
  var form = document.getElementById('resetForm');
  var alertEl = document.getElementById('resetAlert');
  var btn = document.getElementById('resetBtn');
  if (!form) return;

  // Password visibility toggles (IDs for the auth-panel page are different)
  var toggle = document.getElementById('togglePasswordReset') || document.getElementById('togglePassword');
  var toggleConfirm = document.getElementById('toggleConfirmPasswordReset') || document.getElementById('toggleConfirmPasswordReg');
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
  setupToggle(toggle, 'password');
  setupToggle(toggleConfirm, 'confirmPassword');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    alertEl.classList.add('d-none');

    var formData = new FormData(form);
    var password = formData.get('password') || '';
    var confirm = formData.get('confirmPassword') || '';
    var csrfToken = formData.get('csrfToken') || '';
    var token = formData.get('token') || '';

    if (!password || !confirm) return window.authUtils.swalError('Missing information', 'Please enter and confirm your new password.');
    if (password.length < 8) return window.authUtils.swalError('Weak password', 'Password must be at least 8 characters long.');
    if (password !== confirm) return window.authUtils.swalError('Passwords do not match', 'Please ensure both passwords match.');

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Resetting...';

    var recaptchaWidgetPresent = document.querySelector('.g-recaptcha') !== null;
    var recaptcha = (window.grecaptcha && typeof grecaptcha.getResponse === 'function') ? grecaptcha.getResponse() : '';

    if (recaptchaWidgetPresent && !recaptcha) {
      btn.disabled = false;
      btn.innerText = 'Reset Password';
      return window.authUtils.swalError('CAPTCHA required', 'Please complete the CAPTCHA to continue.');
    }

    fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password, token: token, csrfToken: csrfToken, 'g-recaptcha-response': recaptcha })
    })
    .then(function (res) { return res.json().then(function (body) { return { status: res.status, body: body }; }); })
    .then(function (result) {
      if (result.status === 200) {
        window.authUtils.swalSuccess('Password reset', 'Your password has been reset successfully. Redirecting to login...').then(function () {
          window.location.href = '/login';
        });
      } else {
        window.authUtils.swalError('Reset failed', result.body.error || 'Reset failed. Please check your input.');
      }
    })
    .catch(function () {
      window.authUtils.swalError('Network error', 'Unable to reach the server. Please try again later.');
    })
    .finally(function () {
      btn.disabled = false;
      btn.innerText = 'Reset Password';
    });
  });
});
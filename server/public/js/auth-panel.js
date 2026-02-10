document.addEventListener('DOMContentLoaded', function () {
  var root = document.getElementById('authPanelRoot');
  if (!root) return;

  var signUpBtn = document.getElementById('signUp');
  var signInBtn = document.getElementById('signIn');

  function openSignUp() { 
    root.classList.add('right-panel-active');
    // After transition, scroll the sign-up container into view on small screens
    setTimeout(function () {
      var el = root.querySelector('.sign-up-container');
      if (el && window.innerWidth <= 768) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 260);
  }
  function openSignIn() { 
    root.classList.remove('right-panel-active');
    if (window.innerWidth <= 768) window.scrollTo({ top: root.getBoundingClientRect().top + window.pageYOffset - 8, behavior: 'smooth' });
  }

  if (signUpBtn) signUpBtn.addEventListener('click', openSignUp);
  if (signInBtn) signInBtn.addEventListener('click', openSignIn);

  // also wire links inside forms
  var regLinks = document.querySelectorAll('a[href="/register"]');
  regLinks.forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); openSignUp(); }); });

  var loginLinks = document.querySelectorAll('a[href="/login"]');
  loginLinks.forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); openSignIn(); }); });

  // Ensure clicking the form buttons doesn't accidentally submit when toggling
  var signUpForm = document.getElementById('auth-register-form');
  var signInForm = document.getElementById('auth-login-form');

  // small UX: pressing Enter in the register email moves focus to password
  var registerEmail = document.getElementById('register-email');
  if (registerEmail) registerEmail.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('register-password').focus(); }});

});
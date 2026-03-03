document.addEventListener("DOMContentLoaded", function () {
  var root = document.getElementById("authPanelRoot");
  if (!root) return;

  function clearAuthForms() {
    var forms = [
      document.getElementById("auth-login-form"),
      document.getElementById("auth-register-form"),
    ].filter(Boolean);

    forms.forEach(function (form) {
      var fields = form.querySelectorAll(
        'input:not([type="hidden"]), textarea, select',
      );
      fields.forEach(function (field) {
        var tag = (field.tagName || "").toLowerCase();
        var type = (field.type || "").toLowerCase();

        if (tag === "select") {
          field.selectedIndex = 0;
          if (
            field.id === "register-addressCity" ||
            field.id === "register-addressBarangay"
          ) {
            field.disabled = true;
          }
          return;
        }

        if (type === "checkbox" || type === "radio") {
          field.checked = false;
          return;
        }

        field.value = "";
      });
    });

    var otpBlock = document.getElementById("otpBlock");
    if (otpBlock) otpBlock.classList.add("d-none");
  }

  function clearSensitiveFieldsOnly() {
    var sensitiveSelectors = [
      "#email",
      "#password",
      "#register-email",
      "#register-password",
      "#register-confirm",
      "#login-otp",
    ];

    sensitiveSelectors.forEach(function (selector) {
      var el = document.querySelector(selector);
      if (el) el.value = "";
    });
  }

  clearAuthForms();
  clearSensitiveFieldsOnly();

  // Some browsers/password managers autofill shortly after DOM ready; clear again after paint.
  setTimeout(clearSensitiveFieldsOnly, 100);
  setTimeout(clearSensitiveFieldsOnly, 500);
  setTimeout(clearSensitiveFieldsOnly, 1200);

  window.addEventListener("pageshow", function (event) {
    var nav =
      performance && performance.getEntriesByType
        ? performance.getEntriesByType("navigation")[0]
        : null;
    var isBackForward =
      !!(event && event.persisted) || !!(nav && nav.type === "back_forward");
    if (isBackForward) clearAuthForms();
    clearSensitiveFieldsOnly();

    // If browser restores scroll to a previous position, ensure register form is scrolled to top when shown
    var regForm = document.getElementById("auth-register-form");
    if (
      document
        .getElementById("authPanelRoot")
        ?.classList.contains("right-panel-active") &&
      regForm
    ) {
      regForm.scrollTop = 0;
      try {
        document
          .getElementById("register-firstName")
          ?.focus({ preventScroll: true });
      } catch (e) {}
    }
  });

  // Re-apply clear when tab regains focus (covers some autofill extensions).
  // NOTE: changed to avoid clearing user-typed values on window/tab switch (e.g. Alt+Tab).
  // Only clear if none of the sensitive inputs already contain text.
  window.addEventListener("focus", function () {
    try {
      var selectors = [
        "#email",
        "#password",
        "#register-email",
        "#register-password",
        "#register-confirm",
        "#login-otp",
      ];
      var anyFilled = selectors.some(function (sel) {
        var el = document.querySelector(sel);
        return el && String(el.value || "").trim().length > 0;
      });
      if (!anyFilled) clearSensitiveFieldsOnly();
    } catch (e) {
      /* ignore */
    }
  });

  var signUpBtn = document.getElementById("signUp");
  var signInBtn = document.getElementById("signIn");

  function openSignUp() {
    root.classList.add("right-panel-active");
    // mark active state for fade CSS
    root.querySelector(".sign-in-container")?.classList.remove("active");
    root.querySelector(".sign-up-container")?.classList.add("active");

    // Reset internal scroll so the top fields are visible immediately
    var regForm = document.getElementById("auth-register-form");
    if (regForm) regForm.scrollTop = 0;

    // focus the first field shortly after opening so users immediately see top inputs
    setTimeout(function () {
      var first = document.getElementById("register-firstName");
      if (first) {
        try {
          first.focus({ preventScroll: true });
        } catch (e) {
          first.focus();
        }
      }
    }, 180);

    // After transition, scroll the sign-up container into view on small screens
    setTimeout(function () {
      var el = root.querySelector(".sign-up-container");
      if (el && window.innerWidth <= 768) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        if (regForm) regForm.scrollTop = 0;
      }
    }, 260);
  }
  function openSignIn() {
    root.classList.remove("right-panel-active");
    // mark active state for fade CSS
    root.querySelector(".sign-up-container")?.classList.remove("active");
    root.querySelector(".sign-in-container")?.classList.add("active");

    var loginF = document.getElementById("auth-login-form");
    if (loginF) loginF.scrollTop = 0;
    if (window.innerWidth <= 768)
      window.scrollTo({
        top: root.getBoundingClientRect().top + window.pageYOffset - 8,
        behavior: "smooth",
      });
  }

  if (signUpBtn) signUpBtn.addEventListener("click", openSignUp);
  if (signInBtn) signInBtn.addEventListener("click", openSignIn);

  // initialize active class based on current state
  if (root.classList.contains("right-panel-active")) {
    root.querySelector(".sign-up-container")?.classList.add("active");
  } else {
    root.querySelector(".sign-in-container")?.classList.add("active");
  }

  // also wire links inside forms
  var regLinks = document.querySelectorAll('a[href="/register"]');
  regLinks.forEach(function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      openSignUp();
    });
  });

  var loginLinks = document.querySelectorAll('a[href="/login"]');
  loginLinks.forEach(function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      openSignIn();
    });
  });

  // Ensure clicking the form buttons doesn't accidentally submit when toggling
  var signUpForm = document.getElementById("auth-register-form");
  var signInForm = document.getElementById("auth-login-form");

  // add loading spinner to form submit buttons
  function makeButtonLoading(btn) {
    if (!btn) return;
    // prevent double-click
    btn.disabled = true;
    // backup original content so it could be restored if needed
    if (typeof btn.dataset.origHtml === "undefined") {
      btn.dataset.origHtml = btn.innerHTML;
    }
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>' +
      (btn.dataset.origHtml ? btn.dataset.origHtml.replace(/<[^>]+>/g, "") : "Loading...");
  }

  if (signUpForm) {
    var regBtn = document.getElementById("registerBtn");
    signUpForm.addEventListener("submit", function () {
      makeButtonLoading(regBtn);
    });
    if (regBtn) {
      regBtn.addEventListener("click", function () {
        // show loading even if form submission is prevented later
        makeButtonLoading(this);
      });
    }
  }

  if (signInForm) {
    var loginBtn = document.getElementById("loginBtn");
    signInForm.addEventListener("submit", function () {
      makeButtonLoading(loginBtn);
    });
    if (loginBtn) {
      loginBtn.addEventListener("click", function () {
        makeButtonLoading(this);
      });
    }
  }

  // small UX: pressing Enter in the register email moves focus to password
  var registerEmail = document.getElementById("register-email");
  if (registerEmail)
    registerEmail.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        document.getElementById("register-password").focus();
      }
    });

  // If the page initially shows the Sign Up panel, ensure it's scrolled to top on small screens
  if (
    root.classList.contains("right-panel-active") &&
    window.innerWidth <= 768
  ) {
    var el = root.querySelector(".sign-up-container");
    if (el) el.scrollIntoView({ behavior: "auto", block: "start" });
    var formInit = document.getElementById("auth-register-form");
    if (formInit) formInit.scrollTop = 0;
    setTimeout(function () {
      var firstInit = document.getElementById("register-firstName");
      if (firstInit) {
        try {
          firstInit.focus({ preventScroll: true });
        } catch (e) {
          firstInit.focus();
        }
      }
    }, 180);
  }
});

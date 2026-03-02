document.addEventListener("DOMContentLoaded", function () {
  var form = document.getElementById("auth-login-form");
  if (!form) return;

  var btn = form.querySelector('button[type="submit"]');

  // Password visibility toggle: accessible helper
  function setupToggle(toggleEl) {
    if (!toggleEl) return;
    var el = toggleEl.previousElementSibling;
    if (!el || el.tagName !== "INPUT") return;
    toggleEl.addEventListener("click", function () {
      var isPwd = el.getAttribute("type") === "password";
      var type = isPwd ? "text" : "password";
      el.setAttribute("type", type);
      this.innerHTML = isPwd
        ? '<i class="bi bi-eye-slash"></i>'
        : '<i class="bi bi-eye"></i>';
      this.setAttribute("aria-pressed", isPwd ? "true" : "false");
      this.setAttribute(
        "aria-label",
        isPwd ? "Hide password" : "Show password",
      );
    });
  }

  // No OTP logic for login anymore
  setupToggle(document.getElementById("togglePassword"));

  var otpBlock = document.getElementById("otpBlock");
  var otpInput = document.getElementById("login-otp");
  var resendBtn = document.getElementById("resendOtpBtn");

  // helper used by forgot.js; reuse here to throttle OTP resend
  function startResendCooldown(button, duration) {
    var remaining = duration;
    button.disabled = true;
    function tick() {
      if (remaining <= 0) {
        button.disabled = false;
        button.innerText = "Resend OTP";
      } else {
        button.innerText = "Try again in " + remaining + "s";
        remaining -= 1;
        setTimeout(tick, 1000);
      }
    }
    tick();
  }

  // Resend OTP handler (only active when OTP step shown)
  if (resendBtn) {
    resendBtn.addEventListener("click", function () {
      var emailVal = (form.querySelector("#email") || {}).value || "";
      if (!emailVal)
        return window.authUtils.swalError(
          "Missing email",
          "Please enter your email to resend the OTP.",
        );

      // start cooldown immediately so the button is disabled right away
      startResendCooldown(resendBtn, 60);

      fetch("/api/auth/resend-login-otp", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailVal }),
      })
        .then((r) => r.json())
        .then((j) => {
          window.authUtils.swalSuccess(
            "OTP sent",
            j.message || "A new OTP was sent to your email.",
          );
        })
        .catch(() => {
          window.authUtils.swalError(
            "Unable to resend",
            "Please try again later.",
          );
        });
      // cooldown continues independently; no final re-enable here
    });
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    var email = (form.querySelector("#email") || {}).value || "";
    var password = (form.querySelector("#password") || {}).value || "";
    var otp = (form.querySelector("#login-otp") || {}).value || "";
    var mathCaptcha =
      (form.querySelector('input[name="mathCaptcha"]') || {}).value || "";
    var mathAnswer =
      (form.querySelector('input[name="mathAnswer"]') || {}).value || "";
    var csrfToken =
      (form.querySelector('input[name="csrfToken"]') || {}).value || "";

    // If OTP block visible, we are verifying the OTP step
    if (otpBlock && !otpBlock.classList.contains("d-none")) {
      if (!email || !otp)
        return window.authUtils.swalError(
          "Missing code",
          "Please enter the 6-digit code sent to your email.",
        );

      btn.disabled = true;
      var prev = btn.innerHTML;
      btn.innerHTML =
        '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Verifying...';

      try {
        const resp = await fetch("/api/auth/verify-login-otp", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ email: email, otp: otp }),
        });
        const body = await resp.json().catch(() => ({}));
        if (resp.ok && body && body.redirect) {
          window.location.assign(body.redirect);
          return;
        }
        if (resp.ok) {
          window.location.assign("/");
          return;
        }
        if (resp.status === 429) {
          const retry =
            body && body.retryAfter ? Number(body.retryAfter) : null;
          const mins = retry ? Math.ceil(retry / 60) : 5;
          const waitText = mins > 1 ? `${mins} min` : `${mins} minute`;
          window.authUtils.swalError(
            "Too many attempts",
            body.error || `Too many attempts — Try again after ${waitText}`,
          );
        } else {
          window.authUtils.swalError(
            "Verification failed",
            body.error || "Invalid or expired code.",
          );
        }
      } catch (e) {
        window.authUtils.swalError(
          "Network error",
          "Unable to reach the server. Please try again later.",
        );
      } finally {
        btn.disabled = false;
        btn.innerHTML = prev;
      }

      return;
    }

    // Basic login validation (initial password step)
    if (!email || !password || !mathCaptcha) {
      return window.authUtils.swalError(
        "Missing information",
        "Please enter email, password, and captcha.",
      );
    }

    // Enforce password length
    if (password.length > 20) {
      return window.authUtils.swalError(
        "Invalid password",
        "Password cannot be longer than 20 characters.",
      );
    }

    // Enforce at most one '@' and max four digits/@ combined
    var atCount = (password.match(/@/g) || []).length;
    if (atCount > 1) {
      return window.authUtils.swalError(
        "Invalid password",
        "Password may contain at most one '@' character.",
      );
    }
    var specialCount = (password.match(/[@0-9]/g) || []).length;
    if (specialCount > 4) {
      return window.authUtils.swalError(
        "Invalid password",
        "Password may include at most four digits or '@' symbols.",
      );
    }

    // Enforce password characters (letters, numbers, optional @)
    if (!/^[A-Za-z0-9@]+$/.test(password)) {
      return window.authUtils.swalError(
        "Invalid password",
        "Password may contain only letters, numbers, and the '@' symbol.",
      );
    }

    // Enforce numeric math captcha (1-2 digits)
    if (!/^\d{1,2}$/.test(mathCaptcha)) {
      return window.authUtils.swalError(
        "Invalid captcha",
        "Captcha must be a 1–2 digit number.",
      );
    }

    // Disable UI
    btn.disabled = true;
    var previousText = btn.innerHTML;
    btn.innerHTML =
      '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Signing in...';

    // Use session-based secure login (opt-in). Keeps legacy endpoint available server-side.
    var endpoint = "/api/auth/secure/login";
    var payload = {
      email: email,
      password: password,
      csrfToken: csrfToken,
      mathCaptcha: mathCaptcha,
      mathAnswer: mathAnswer,
    };

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));

      // If server indicates OTP required for privileged role, show OTP input
      if (res.ok && body && body.requiresOTP) {
        if (otpBlock) otpBlock.classList.remove("d-none");
        if (otpInput) {
          otpInput.focus();
          otpInput.value = "";
        }
        window.authUtils.swalSuccess(
          "OTP sent",
          body.message || "A verification code was sent to your email.",
        );
        // begin the resend cooldown immediately so user can't hammer the
        // button right after the initial code has been generated
        if (resendBtn) startResendCooldown(resendBtn, 60);
        return;
      }

      if (res.ok && body && body.redirect) {
        window.location.assign(body.redirect);
        return;
      }

      if (res.ok) {
        window.location.assign("/");
        return;
      }

      if (res.status === 429) {
        const retry = body && body.retryAfter ? Number(body.retryAfter) : null;
        const mins = retry ? Math.ceil(retry / 60) : 5;
        const waitText = mins > 1 ? `${mins} min` : `${mins} minute`;
        window.authUtils.swalError(
          "Too many attempts",
          body.error || `Too many login attempts — Try again after ${waitText}`,
          { reload: true },
        );
      } else {
        window.authUtils.swalError(
          "Login failed",
          body && body.error
            ? body.error
            : "Invalid email or password. Please try again.",
        );
      }
    } catch (e) {
      window.authUtils.swalError(
        "Network error",
        "Unable to reach the server. Please try again later.",
      );
    } finally {
      btn.disabled = false;
      btn.innerHTML = previousText;
    }
  });

  // Show success toast if registered recently or display a passed message
  var params = new URLSearchParams(window.location.search);
  if (params.get("registered")) {
    var removeRegisteredParam = function () {
      if (window.history && typeof window.history.replaceState === "function") {
        try {
          var u = new URL(window.location.href);
          u.searchParams.delete("registered");
          window.history.replaceState(null, "", u.pathname + u.search + u.hash);
        } catch (e) {
          // fallback: replace without query
          window.history.replaceState(
            null,
            "",
            window.location.pathname + window.location.hash,
          );
        }
      }
    };

    var res = window.authUtils.swalSuccess(
      "Account created",
      "Your account was created successfully. Please log in.",
    );
    if (res && typeof res.then === "function") {
      res.then(removeRegisteredParam).catch(removeRegisteredParam);
    } else {
      removeRegisteredParam();
    }
  }

  // Show arbitrary message passed via ?msg= on the login page (e.g. "Please log in to continue.")
  if (params.get("msg")) {
    try {
      window.authUtils.swalError("Please sign in", params.get("msg"));
    } catch (e) {
      /* ignore */
    }
  }
});

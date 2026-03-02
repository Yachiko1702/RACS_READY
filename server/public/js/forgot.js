document.addEventListener("DOMContentLoaded", function () {
  var form =
    document.getElementById("forgotForm") ||
    document.getElementById("forgot-form");
  var alertEl = document.getElementById("forgotAlert");
  var btn = document.getElementById("forgotBtn");
  if (!form) return;

  function startResendCooldown(button, duration) {
    var remaining = duration;
    button.disabled = true;
    function tick() {
      if (remaining <= 0) {
        button.disabled = false;
        button.innerText = "Send Reset Link";
      } else {
        button.innerText = "Try again in " + remaining + "s";
        remaining -= 1;
        setTimeout(tick, 1000);
      }
    }
    tick();
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    alertEl.classList.add("d-none");

    var formData = new FormData(form);
    var email = formData.get("email") || formData.get("forgot-email") || "";
    var csrfToken = formData.get("csrfToken") || "";
    var mathCaptcha = String(formData.get("mathCaptcha") || "").trim();
    var mathAnswer = String(formData.get("mathAnswer") || "").trim();

    email = String(email).trim();
    if (!email)
      return window.authUtils.swalError(
        "Missing information",
        "Please enter your email address.",
      );
    if (email.length > 50)
      return window.authUtils.swalError("Invalid email", "Email is too long.");
    if (!window.authUtils.validateEmail(email))
      return window.authUtils.swalError(
        "Invalid email",
        "Please enter a valid email address.",
      );
    if (!mathCaptcha || !/^[0-9]{1,2}$/.test(mathCaptcha)) {
      return window.authUtils.swalError(
        "Invalid captcha",
        "Please answer the math question.",
      );
    }
    if (mathCaptcha !== mathAnswer) {
      return window.authUtils.swalError(
        "Incorrect captcha",
        "Math answer does not match.",
      );
    }

    btn.disabled = true;
    var previousText = btn.innerHTML;
    btn.innerHTML =
      '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Sending...';

    fetch("/api/auth/forgot-password", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email,
        csrfToken: csrfToken,
        mathCaptcha: mathCaptcha,
        mathAnswer: mathAnswer,
      }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          return { status: res.status, body: body };
        });
      })
      .then(function (result) {
        // handle rate-limit from server
        if (result.status === 429) {
          var retry =
            result.body && result.body.retryAfter
              ? result.body.retryAfter
              : null;
          var text =
            "Too many requests. Please wait a short while before retrying. Further failures will extend the block duration.";
          if (retry)
            text =
              "Too many requests. Please wait " +
              retry +
              " seconds and try again. Additional failures will increase this wait period.";
          return window.authUtils.swalError("Too many requests", text);
        }
        // Generic success message for privacy
        window.authUtils.swalSuccess(
          "Request received",
          "If an account with that email exists, we have sent a password reset link.",
        );
        startResendCooldown(btn, 60);
      })
      .catch(function () {
        window.authUtils.swalSuccess(
          "Request received",
          "If an account with that email exists, we have sent a password reset link.",
        );
        startResendCooldown(btn, 60);
      })
      .finally(function () {
        // do not re-enable here; cooldown handles enabling
      });
  });
});

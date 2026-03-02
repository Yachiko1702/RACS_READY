document.addEventListener("DOMContentLoaded", function () {
  var form = document.getElementById("resetForm");
  var alertEl = document.getElementById("resetAlert");
  var btn = document.getElementById("resetBtn");
  if (!form) return;

  // Password visibility toggles
  var toggle =
    document.getElementById("togglePasswordReset") ||
    document.getElementById("togglePassword");
  var toggleConfirm =
    document.getElementById("toggleConfirmPasswordReset") ||
    document.getElementById("toggleConfirmPasswordReg");
  function setupToggle(toggleEl, inputId) {
    if (!toggleEl) return;
    toggleEl.addEventListener("click", function () {
      var el = document.getElementById(inputId);
      if (!el) return;
      var type = el.getAttribute("type") === "password" ? "text" : "password";
      el.setAttribute("type", type);
      this.innerHTML =
        type === "password"
          ? '<i class="bi bi-eye"></i>'
          : '<i class="bi bi-eye-slash"></i>';
    });
  }
  setupToggle(toggle, "password");
  setupToggle(toggleConfirm, "confirmPassword");

  // sanitize and match indicator
  var pwField = document.getElementById("password");
  var confField = document.getElementById("confirmPassword");
  try {
    function sanitize(el) {
      if (!el) return;
      el.addEventListener("input", function () {
        var v = String(this.value || "");
        v = v.replace(/[^A-Za-z0-9@]/g, "");
        var parts = v.split("@");
        if (parts.length > 2) v = parts[0] + "@" + parts.slice(1).join("");
        // drop extra uppercase letters beyond the first
        var seen = false;
        var out = "";
        for (var i = 0; i < v.length; i++) {
          var ch = v[i];
          if (ch >= 'A' && ch <= 'Z') {
            if (!seen) { out += ch; seen = true; }
          } else {
            out += ch;
          }
        }
        this.value = out.slice(0, 20);
      });
    }
    sanitize(pwField);
    sanitize(confField);

    var matchInd = document.getElementById("reset-confirm-check");
    var validInd = document.getElementById("reset-password-check");
    var suggestEl = document.getElementById("reset-password-suggestions");

    function updateSuggest() {
      if (!suggestEl) return;
      var pwd = pwField ? pwField.value : "";
      var lenOk = pwd.length >= 8 && pwd.length <= 20;
      var upperCount = (pwd.match(/[A-Z]/g) || []).length;
      var atCount = (pwd.match(/@/g) || []).length;
      var partsOk = atCount <= 1;
      var points = (lenOk ? 1 : 0) + (upperCount === 1 ? 1 : 0) + (partsOk ? 1 : 0);
      var strength = points <= 1 ? "Weak" : points === 2 ? "Moderate" : "Strong";
      suggestEl.classList.remove("text-danger", "text-warning", "text-success");
      if (strength === "Weak") suggestEl.classList.add("text-danger");
      else if (strength === "Moderate") suggestEl.classList.add("text-warning");
      else suggestEl.classList.add("text-success");
      var lines = [];
      lines.push(strength + " password");
      lines.push(lenOk ? "✓ 8–20 chars" : "✗ 8–20 chars");
      lines.push(upperCount === 1 ? "✓ one uppercase" : "✗ one uppercase");
      lines.push(partsOk ? "✓ ≤1 @" : "✗ at most one @");
      suggestEl.textContent = lines.join(" • ");
    }

    function updateBoth() {
      var pwd = pwField && pwField.value ? pwField.value : "";
      var conf = confField && confField.value ? confField.value : "";
      var ok = /^(?=(?:.*[A-Z]){1})(?!.*[A-Z].*[A-Z])(?!.*@.*@)[A-Za-z0-9@]{8,20}$/.test(pwd);

      // confirm icon
      if (matchInd) {
        if (conf.length === 0) {
          matchInd.classList.add("d-none");
        } else {
          matchInd.classList.remove("d-none");
          if (pwd === conf && ok) {
            matchInd.innerHTML = '<i class="bi bi-check-lg text-success"></i>';
          } else {
            matchInd.innerHTML = '<i class="bi bi-x-lg text-danger"></i>';
          }
        }
      }
      // password icon: show check when complexity ok; if confirm exists also require match
      if (validInd) {
        if (pwd.length > 0) {
          validInd.classList.remove("d-none");
          if (ok && (conf.length === 0 || pwd === conf)) {
            validInd.innerHTML = '<i class="bi bi-check-lg text-success"></i>';
          } else {
            validInd.innerHTML = '<i class="bi bi-x-lg text-danger"></i>';
          }
        } else {
          validInd.classList.add("d-none");
        }
      }
    }
    if (pwField && confField) {
      pwField.addEventListener("input", function () {
        updateBoth();
        updateSuggest();
      });
      confField.addEventListener("input", updateBoth);
      // ensure initial suggestions shown
      updateSuggest();
    }
  } catch (e) {
    console.error("Reset password input setup error", e);
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (alertEl) alertEl.classList.add("d-none");

    var formData = new FormData(form);
    var password = String(formData.get("password") || "");
    var confirm = String(formData.get("confirmPassword") || "");
    var csrfToken = String(formData.get("csrfToken") || "");
    var token = String(formData.get("token") || "");

    if (!password || !confirm)
      return window.authUtils.swalError(
        "Missing information",
        "Please enter and confirm your new password.",
      );
    if (password.length < 8)
      return window.authUtils.swalError(
        "Weak password",
        "Password must be at least 8 characters long.",
      );
    if (password.length > 20)
      return window.authUtils.swalError(
        "Invalid password",
        "Password cannot be longer than 20 characters.",
      );
    // complexity: 8–20 chars, letters/numbers and max one '@', exactly one uppercase
    if (!/^(?=(?:.*[A-Z]){1})(?!.*[A-Z].*[A-Z])(?!.*@.*@)[A-Za-z0-9@]{8,20}$/.test(password))
      return window.authUtils.swalError(
        "Invalid password",
        "Password must be 8–20 characters, letters/numbers with at most one '@', and exactly one uppercase letter.",
      );
    if (password !== confirm)
      return window.authUtils.swalError(
        "Passwords do not match",
        "Please ensure both passwords match.",
      );

    btn.disabled = true;
    var prevText = btn.innerText;
    btn.innerHTML =
      '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Resetting...';

    try {
      var res = await fetch("/api/auth/reset-password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: password,
          token: token,
          csrfToken: csrfToken,
        }),
      });

      var body = {};
      try {
        body = await res.json();
      } catch (e) {
        body = {};
      }

      if (res.status === 200) {
        await window.authUtils.swalSuccess(
          "Password reset",
          "Your password has been reset successfully. Redirecting to login...",
        );
        window.location.href = "/login";
        return;
      }

      // Show server-provided error where available
      var errMsg =
        body && (body.error || body.message)
          ? body.error || body.message
          : "Reset failed. Please check your input.";
      window.authUtils.swalError("Reset failed", errMsg);
    } catch (err) {
      console.error("Reset error", err);
      window.authUtils.swalError(
        "Network error",
        "Unable to reach the server. Please try again later.",
      );
    } finally {
      btn.disabled = false;
      btn.innerText = prevText || "Reset Password";
    }
  });
});

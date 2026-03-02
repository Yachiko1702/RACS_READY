document.addEventListener("DOMContentLoaded", function () {
  var form =
    document.getElementById("auth-register-form") ||
    document.getElementById("registerForm");
  var alertEl = document.getElementById("registerAlert");
  var btn = document.getElementById("registerBtn");

  if (!form) return;

  // Password visibility toggles
  var toggle = document.getElementById("togglePasswordReg");
  var toggleConfirm = document.getElementById("toggleConfirmPasswordReg");
  function setupToggle(toggleEl) {
    if (!toggleEl) return;
    var el = toggleEl.previousElementSibling;
    if (!el || el.tagName !== "INPUT") return;
    toggleEl.addEventListener("click", function () {
      var type = el.getAttribute("type") === "password" ? "text" : "password";
      el.setAttribute("type", type);
      this.innerHTML =
        type === "password"
          ? '<i class="bi bi-eye"></i>'
          : '<i class="bi bi-eye-slash"></i>';
    });
  }
  // Attach toggle handlers
  setupToggle(toggle);
  setupToggle(toggleConfirm);

  // Ensure phone input only contains digits while typing and limit to Philippine formats
  try {
    var phoneField = document.getElementById("register-phone");
    if (phoneField) {
      phoneField.addEventListener("input", function () {
        var v = this.value || "";
        // keep digits only and limit to 11 (e.g. 09XXXXXXXXX) or 10 (if user omits leading 0)
        this.value = v.replace(/\D+/g, "").slice(0, 11);
      });
    }

    // Postal code sanitizer: digits only, max 4
    var postalField = document.getElementById("register-addressPostal");
    if (postalField) {
      postalField.addEventListener("input", function () {
        this.value = String(this.value || "")
          .replace(/\D+/g, "")
          .slice(0, 4);
      });
    }
  } catch (e) {
    console.error("Phone/postal input setup error", e);
  }

  // Restrict first/last name to letters and spaces, max 20 chars
  try {
    var firstField = document.getElementById("register-firstName");
    var lastField = document.getElementById("register-lastName");
    function sanitizeNameInput(el) {
      if (!el) return;
      el.addEventListener("input", function () {
        var v = String(this.value || "");
        v = v.replace(/[^A-Za-z\s]/g, "");
        this.value = v.slice(0, 20);
      });
    }
    sanitizeNameInput(firstField);
    sanitizeNameInput(lastField);
  } catch (e) {
    console.error("Name input setup error", e);
  }

// sanitize password fields: allow letters, numbers and '@'; enforce single '@' and max 20
  try {
    var passField = document.getElementById("register-password");
    var confirmField = document.getElementById("register-confirm");
    function sanitizePwd(el) {
      if (!el) return;
      el.addEventListener("input", function () {
        var v = String(this.value || "");
        // strip invalid characters
        v = v.replace(/[^A-Za-z0-9@]/g, "");
        // allow at most one '@'
        var parts = v.split("@");
        if (parts.length > 2) {
          v = parts[0] + "@" + parts.slice(1).join("");
        }
        // enforce single uppercase letter: keep first uppercase, drop extras
        var seenUpper = false;
        var out = "";
        for (var i = 0; i < v.length; i++) {
          var ch = v[i];
          if (ch >= 'A' && ch <= 'Z') {
            if (!seenUpper) {
              out += ch;
              seenUpper = true;
            }
          } else {
            out += ch;
          }
        }
        this.value = out.slice(0, 20);
      });
    }
    sanitizePwd(passField);
    sanitizePwd(confirmField);

    // indicator elements
    var matchIndicator = document.getElementById("register-confirm-check");
    var validityIndicator = document.getElementById("register-password-check");
    var suggestionEl = document.getElementById("register-password-suggestions");

    function updateSuggestions() {
      if (!suggestionEl) return;
      var pwd = passField ? passField.value : "";
      var lenOk = pwd.length >= 8 && pwd.length <= 20;
      var upperCount = (pwd.match(/[A-Z]/g) || []).length;
      var atCount = (pwd.match(/@/g) || []).length;
      var partsOk = atCount <= 1;
      var points = (lenOk ? 1 : 0) + (upperCount === 1 ? 1 : 0) + (partsOk ? 1 : 0);
      var strength = points <= 1 ? "Weak" : points === 2 ? "Moderate" : "Strong";
      suggestionEl.classList.remove("text-danger", "text-warning", "text-success");
      if (strength === "Weak") suggestionEl.classList.add("text-danger");
      else if (strength === "Moderate") suggestionEl.classList.add("text-warning");
      else suggestionEl.classList.add("text-success");
      var lines = [];
      lines.push(strength + " password");
      lines.push(lenOk ? "✓ 8–20 chars" : "✗ 8–20 chars");
      lines.push(upperCount === 1 ? "✓ one uppercase" : "✗ one uppercase");
      lines.push(partsOk ? "✓ ≤1 @" : "✗ at most one @");
      suggestionEl.textContent = lines.join(" • ");
    }

    function updateIndicators() {
      var pwd = passField && passField.value ? passField.value : "";
      var conf = confirmField && confirmField.value ? confirmField.value : "";
      var ok = /^(?=(?:.*[A-Z]){1})(?!.*[A-Z].*[A-Z])(?!.*@.*@)[A-Za-z0-9@]{8,20}$/.test(pwd);

      // update match indicator (only meaningful when confirm filled)
      if (matchIndicator) {
        if (conf.length === 0) {
          matchIndicator.classList.add("d-none");
        } else {
          matchIndicator.classList.remove("d-none");
          if (pwd === conf && ok) {
            matchIndicator.innerHTML = '<i class="bi bi-check-lg text-success"></i>';
          } else {
            matchIndicator.innerHTML = '<i class="bi bi-x-lg text-danger"></i>';
          }
        }
      }

      // password indicator: show check when complexity ok (regardless of confirm).
      // when confirm is filled, also require it to match; otherwise show X.
      if (validityIndicator) {
        if (pwd.length > 0) {
          validityIndicator.classList.remove("d-none");
          if (ok && (conf.length === 0 || pwd === conf)) {
            validityIndicator.innerHTML = '<i class="bi bi-check-lg text-success"></i>';
          } else {
            validityIndicator.innerHTML = '<i class="bi bi-x-lg text-danger"></i>';
          }
        } else {
          validityIndicator.classList.add("d-none");
        }
      }
    }
    if (passField && confirmField) {
      passField.addEventListener("input", function() {
        updateIndicators();
        updateSuggestions();
      });
      confirmField.addEventListener("input", updateIndicators);
      // initial suggestion state
      updateSuggestions();
    }
  } catch (e) {
    console.error("Password input setup error", e);
  }

  if (alertEl) alertEl.classList.add("d-none");
  if (!btn) btn = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", async function (e) {
    try {
      e.preventDefault();
      if (alertEl) alertEl.classList.add("d-none");

      var formData = new FormData(form);
      var email = formData.get("email") || "";
      var password = formData.get("password") || "";
      var confirm = formData.get("confirmPassword") || "";
      var firstName = formData.get("firstName") || "";
      var lastName = formData.get("lastName") || "";
      var phone = formData.get("phone") || "";
      var addressCityValue = formData.get("addressCity") || "";
      var addressProvinceValue = formData.get("addressProvince") || "";
      var addressBarangayValue = formData.get("addressBarangay") || "";
      // Prefer the visible selected text (human-readable) for storing address fields.
      var addressProvince = (function () {
        try {
          var el = document.getElementById("register-addressProvince");
          var opt = el && el.selectedOptions && el.selectedOptions[0];
          return (
            (opt && opt.textContent && opt.textContent.trim()) ||
            addressProvinceValue ||
            ""
          );
        } catch (e) {
          return addressProvinceValue || "";
        }
      })();
      var addressCity = (function () {
        try {
          var el = document.getElementById("register-addressCity");
          var opt = el && el.selectedOptions && el.selectedOptions[0];
          return (
            (opt && opt.textContent && opt.textContent.trim()) ||
            addressCityValue ||
            ""
          );
        } catch (e) {
          return addressCityValue || "";
        }
      })();
      var addressBarangay = (function () {
        try {
          var el = document.getElementById("register-addressBarangay");
          var opt = el && el.selectedOptions && el.selectedOptions[0];
          return (
            (opt && opt.textContent && opt.textContent.trim()) ||
            addressBarangayValue ||
            ""
          );
        } catch (e) {
          return addressBarangayValue || "";
        }
      })();
      var addressPostal = formData.get("addressPostal") || "";

      // ensure we send street even if blank
      var otp = formData.get("otp") || "";
      var mathCaptcha = formData.get("mathCaptcha") || "";
      var mathAnswer = formData.get("mathAnswer") || "";
      var csrfToken = formData.get("csrfToken") || "";

      // Initial registration validation (no OTP flow)
      if (
        !email ||
        !password ||
        !confirm ||
        !firstName ||
        !lastName ||
        !phone ||
        !addressCity ||
        !addressProvince ||
        !addressPostal ||
        !mathCaptcha
      ) {
        return window.authUtils.swalError(
          "Missing information",
          "Please complete all required fields.",
        );
      }

      // Math captcha must be numeric and 1-2 digits
      if (!/^\d{1,2}$/.test(mathCaptcha)) {
        return window.authUtils.swalError(
          "Invalid captcha",
          "Captcha must be a 1–2 digit number.",
        );
      }

      // Validate name fields (letters + spaces only, max 20)
      var nameRe = /^[A-Za-z\s]{1,20}$/;
      if (!nameRe.test(firstName))
        return window.authUtils.swalError(
          "Invalid first name",
          "First name must be letters only and maximum 20 characters.",
        );
      if (!nameRe.test(lastName))
        return window.authUtils.swalError(
          "Invalid last name",
          "Last name must be letters only and maximum 20 characters.",
        );

      // Normalize phone digits and validate Philippine mobile formats
      var phoneDigits = String(phone || "").replace(/\D+/g, "");
      var phoneOk = /^(?:0\d{10}|63\d{10}|9\d{9})$/.test(phoneDigits);
      if (!phoneOk)
        return window.authUtils.swalError(
          "Invalid phone",
          "Phone must be a Philippine mobile number (e.g. 09XXXXXXXXX or +639XXXXXXXXX).",
        );

      // Keep the digits-only phone value for submission
      phone = phoneDigits;

      if (!window.authUtils.validateEmail(email)) {
        return window.authUtils.swalError(
          "Invalid email",
          "Please provide a valid email address.",
        );
      }

      // Quick typo/domain suggestion for common providers
      var suggestion = (function suggestEmailDomain(inEmail) {
        try {
          var parts = String(inEmail).split("@");
          if (parts.length !== 2) return null;
          var local = parts[0];
          var domain = parts[1].toLowerCase();
          var common = [
            "gmail.com",
            "yahoo.com",
            "outlook.com",
            "hotmail.com",
            "icloud.com",
          ];

          function levenshtein(a, b) {
            var m = [],
              i,
              j;
            for (i = 0; i <= a.length; i++) {
              m[i] = [i];
            }
            for (j = 0; j <= b.length; j++) {
              m[0][j] = j;
            }
            for (i = 1; i <= a.length; i++) {
              for (j = 1; j <= b.length; j++) {
                if (a.charAt(i - 1) === b.charAt(j - 1)) {
                  m[i][j] = m[i - 1][j - 1];
                } else {
                  m[i][j] = Math.min(
                    m[i - 1][j - 1] + 1,
                    m[i][j - 1] + 1,
                    m[i - 1][j] + 1,
                  );
                }
              }
            }
            return m[a.length][b.length];
          }

          var best = { domain: null, dist: 999 };
          common.forEach(function (d) {
            var dist = levenshtein(domain, d);
            if (dist < best.dist) best = { domain: d, dist: dist };
          });
          if (
            best.domain &&
            best.dist > 0 &&
            best.dist <= 2 &&
            best.domain !== domain
          ) {
            return local + "@" + best.domain;
          }
        } catch (e) {
          return null;
        }
        return null;
      })(email);

      if (suggestion) {
        var use = await Swal.fire({
          title: "Did you mean " + suggestion + "?",
          text:
            "There is no email provider matching the domain you typed. Did you mean " +
            suggestion +
            "?",
          icon: "question",
          showCancelButton: true,
          confirmButtonText: "Use suggestion",
          cancelButtonText: "Keep original",
        });
        if (use && use.isConfirmed) {
          // update input and continue
          var emailField = form.querySelector('input[name="email"]');
          if (emailField) {
            emailField.value = suggestion;
            email = suggestion;
          }
        }
      }

      if (password.length < 8) {
        return window.authUtils.swalError(
          "Weak password",
          "Password must be at least 8 characters long.",
        );
      }

      if (password.length > 20) {
        return window.authUtils.swalError(
          "Invalid password",
          "Password cannot be longer than 20 characters.",
        );
      }

      // complexity: 8–20 chars, letters/numbers and max one '@', exactly one uppercase
      if (!/^(?=(?:.*[A-Z]){1})(?!.*[A-Z].*[A-Z])(?!.*@.*@)[A-Za-z0-9@]{8,20}$/.test(password)) {
        return window.authUtils.swalError(
          "Invalid password",
          "Password must be 8–20 characters, letters/numbers with at most one '@', and exactly one uppercase letter.",
        );
      }

      if (password !== confirm) {
        return window.authUtils.swalError(
          "Passwords do not match",
          "Please ensure both password fields match.",
        );
      }
      // store previous label so we can restore
      var previousText = btn ? btn.innerHTML : "Sign Up";
      btn.disabled = true;
      btn.innerHTML =
        '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Sending...';

      var endpoint = "/api/auth/register";
      var payload = {
        email: email,
        password: password,
        csrfToken: csrfToken,
        firstName: firstName,
        lastName: lastName,
        phone: phone,

        addressCity: addressCity,
        addressProvince: addressProvince,
        addressBarangay: addressBarangay,
        addressPostal: addressPostal,
        mathCaptcha: mathCaptcha,
        mathAnswer: mathAnswer,
      };

      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          return res.json().then(function (body) {
            return { status: res.status, body: body };
          });
        })
        .then(function (result) {
          if (result.status === 201) {
            // Let login page show the registration success toast to avoid duplicate popups
            window.location.href = "/login?registered=1";
          } else if (result.status === 429) {
            window.authUtils.swalError(
              "Too many attempts",
              "Please wait a short while and try again.",
              { reload: true },
            );
          } else {
            window.authUtils.swalError(
              "Failed",
              result.body && result.body.error
                ? result.body.error
                : "An error occurred.",
            );
          }
        })
        .catch(function () {
          window.authUtils.swalError(
            "Network error",
            "Unable to reach the server. Please try again later.",
          );
          try {
            window.authRecaptchaReset("register");
          } catch (e) {}
        })
        .finally(function () {
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = previousText;
          }
        });
    } catch (error) {
      console.error("Error in register submit:", error);
      window.authUtils.swalError("Error", "An unexpected error occurred.");
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = previousText;
      }
    }
  });

  // No OTP resend logic required anymore
});

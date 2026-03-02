// Auth helpers (Swal wrappers and validators) - keep small and framework-agnostic
(function () {
  window.authUtils = {
    swalError: function (title, text, opts) {
      opts = opts || {};
      return Swal.fire({
        icon: "error",
        title: title || "Error",
        text: text || "",
        confirmButtonText: "OK",
      }).then(function (res) {
        try {
          if (opts.reload) {
            // small delay so the swal closes visually before reload
            setTimeout(function () {
              window.location.reload();
            }, 150);
          }
        } catch (e) {}
        return res;
      });
    },

    swalSuccess: function (title, text) {
      return Swal.fire({
        icon: "success",
        title: title || "Success",
        text: text || "",
        confirmButtonText: "OK",
      });
    },

    swalToast: function (icon, title) {
      return Swal.fire({
        toast: true,
        position: "top-end",
        showConfirmButton: false,
        timer: 3000,
        icon: icon,
        title: title,
      });
    },

    validateEmail: function (email) {
      if (!email) return false;
      // strict: only letters/digits, exactly one '@' and exactly one '.' in the domain
      var re = /^[A-Za-z0-9]+@[A-Za-z0-9]+\.[A-Za-z0-9]+$/;
      return re.test(String(email));
    },
  };
})();

// Security: enforce client-side input limits and sanitization for auth forms
(function () {
  function stripControlChars(s) {
    return String(s).replace(/[\x00-\x1F\x7F<>\\]/g, "");
  }

  function sanitizeEmail(value) {
    // Trim, remove control chars/spaces, then only allow letters, digits, `@` and `.`
    var v = String(value || "").trim();
    v = v.replace(/\s+/g, "");
    v = stripControlChars(v);
    // remove any character that is not a letter, digit, @ or dot
    v = v.replace(/[^A-Za-z0-9@.]/g, "");
    // keep only the first @ if multiple present and enforce single dot in domain
    var atIndex = v.indexOf("@");
    if (atIndex !== -1) {
      var local = v.slice(0, atIndex).replace(/\./g, "");
      var domain = v.slice(atIndex + 1).replace(/[^A-Za-z0-9.]/g, "");
      if (domain.indexOf(".") !== -1) {
        var parts = domain.split(".");
        domain = parts[0] + "." + parts.slice(1).join("");
      }
      v = local + "@" + domain.replace(/@/g, "");
    } else {
      // no @ yet: strip dots from local part
      v = v.replace(/\./g, "");
    }
    return v;
  }

  function sanitizePassword(value) {
    // allow letters, digits and a single '@'; strip other special chars
    var v = String(value || "");
    v = v.replace(/[\x00-\x1F\x7F]/g, "");
    v = v.replace(/[^A-Za-z0-9@]/g, "");
    // ensure only one '@'
    var parts = v.split("@");
    if (parts.length > 2) {
      v = parts[0] + "@" + parts.slice(1).join("");
    }
    // enforce max 4 digits/@ combined
    var specials = v.match(/[@0-9]/g) || [];
    if (specials.length > 4) {
      var keep = 4;
      var out = "";
      for (var i = 0; i < v.length; i++) {
        var ch = v[i];
        if (/[@0-9]/.test(ch)) {
          if (keep > 0) {
            out += ch;
            keep--;
          }
        } else {
          out += ch;
        }
      }
      v = out;
    }
    return v;
  }

  function applyLimitsToInput(el, max) {
    if (!el) return;
    if (max && !el.getAttribute("maxlength"))
      el.setAttribute("maxlength", String(max));

    // On input: sanitize and enforce maxlength
    el.addEventListener(
      "input",
      function (e) {
        var prev = el.value;
        var next = prev;
        if (
          el.type === "email" ||
          /email/i.test(el.name) ||
          /email/i.test(el.id)
        ) {
          next = sanitizeEmail(prev);
          next = next.slice(0, max || 50);
        } else if (
          el.type === "password" ||
          /password/i.test(el.name) ||
          /password/i.test(el.id)
        ) {
          next = sanitizePassword(prev).slice(0, max || 128);
        } else if (
          el.name &&
          /otp|code|pin|mathcaptcha|math|postal/i.test(el.name)
        ) {
          // numeric-only fields (OTP, math captcha, postal codes)
          next = String(prev)
            .replace(/[^0-9]/g, "")
            .slice(0, max || 6);
        } else {
          // generic: strip control chars and limit
          next = stripControlChars(prev).slice(0, max || 256);
        }
        if (next !== prev) {
          var pos = el.selectionStart || 0;
          el.value = next;
          try {
            el.setSelectionRange(pos - 1, pos - 1);
          } catch (e) {}
        }
      },
      { passive: true },
    );

    // On paste: allow native browser paste (prevents Ctrl+V blocking/duplication),
    // then sanitize/trim after the value is inserted.
    el.addEventListener("paste", function () {
      setTimeout(function () {
        try {
          var prev = el.value;
          var next = prev;
          if (
            el.type === "email" ||
            /email/i.test(el.name) ||
            /email/i.test(el.id)
          ) {
            next = sanitizeEmail(prev).slice(0, max || 50);
          } else if (
            el.type === "password" ||
            /password/i.test(el.name) ||
            /password/i.test(el.id)
          ) {
            next = sanitizePassword(prev).slice(0, max || 128);
          } else if (
            el.name &&
            /otp|code|pin|mathcaptcha|math/i.test(el.name)
          ) {
            next = String(prev)
              .replace(/[^0-9]/g, "")
              .slice(0, max || 6);
          } else {
            next = stripControlChars(prev).slice(0, max || 256);
          }
          if (next !== prev) el.value = next;
        } catch (err) {
          /* ignore */
        }
      }, 0);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    try {
      // Find relevant inputs across auth pages
      var selectors = [
        'input[type="email"]',
        'input[type="password"]',
        'input[name="otp"]',
        'input[id$="-otp"]',
        'input[name="confirmPassword"]',
        'input[name="mathCaptcha"]',
        'input[name="addressPostal"]',
      ];
      var inputs = document.querySelectorAll(selectors.join(","));
      inputs.forEach(function (el) {
        if (!el) return;
        var name = (el.name || el.id || "").toLowerCase();
        if (el.type === "email" || name.indexOf("email") !== -1)
          applyLimitsToInput(el, 50);
        else if (el.type === "password" || name.indexOf("password") !== -1)
          applyLimitsToInput(el, 20);
        else if (name.indexOf("math") !== -1 || /mathcaptcha/.test(name))
          applyLimitsToInput(el, 2);
        else if (name.indexOf("otp") !== -1 || /pin|code/.test(name))
          applyLimitsToInput(el, 6);
        else if (name.indexOf("postal") !== -1) applyLimitsToInput(el, 4);
        else applyLimitsToInput(el, 256);
      });
    } catch (e) {
      console.error("auth input limits init failed", e);
    }

    // add math captcha reload support
    try {
      var captchas = document.querySelectorAll(".math-captcha");
      captchas.forEach(function (container) {
        var btn = container.querySelector(".refresh-captcha");
        if (!btn) return;
        btn.addEventListener("click", function () {
          btn.disabled = true;
          fetch("/math-captcha")
            .then(function (r) {
              return r.json();
            })
            .then(function (j) {
              if (j.question) {
                var span = container.querySelector(".captcha-question");
                if (span) span.textContent = j.question;
                else
                  container.querySelector(".form-label").textContent =
                    j.question;
              }
              if (typeof j.answer !== "undefined") {
                var hid = container.querySelector('input[name="mathAnswer"]');
                if (hid) hid.value = j.answer;
              }
              var inp = container.querySelector('input[name="mathCaptcha"]');
              if (inp) inp.value = "";
            })
            .catch(function () {
              /* ignore */
            })
            .finally(function () {
              btn.disabled = false;
            });
        });
      });
    } catch (e) {
      console.error("math captcha reload init failed", e);
    }

    // if we're on a very narrow screen, disable vertical scrolling globally
    if (window.innerWidth <= 425) {
      document.documentElement.style.overflowY = "hidden";
      document.body.style.overflowY = "hidden";
    }
  }); // end DOMContentLoaded

  // reCAPTCHA explicit render initializer and helpers
  window._authRecaptchaWidgets = window._authRecaptchaWidgets || {};
  window.initRecaptcha = function () {
    try {
      if (
        !window.recaptchaSiteKey ||
        typeof grecaptcha === "undefined" ||
        typeof grecaptcha.render !== "function"
      )
        return;
      // Render widgets for known containers if present
      var map = {
        register: "recaptcha-register",
        login: "recaptcha-login",
        reset: "recaptcha-reset",
        forgot: "recaptcha-forgot",
      };
      Object.keys(map).forEach(function (k) {
        var elId = map[k];
        var el = document.getElementById(elId);
        if (!el) return;
        // Render explicitly and store widget id
        try {
          // prevent double-render by clearing element content
          el.innerHTML = "";
          // callback sets timestamp on solve
          var wid = grecaptcha.render(elId, {
            sitekey: window.recaptchaSiteKey,
            theme: "light",
            callback: function (token) {
              try {
                var tsId = "recaptcha-ts-" + k;
                var tsEl = document.getElementById(tsId);
                if (tsEl) tsEl.value = String(Date.now());
              } catch (e) {}
            },
          });
          window._authRecaptchaWidgets[k] = wid;
        } catch (e) {
          // ignore
          console.error("recaptcha render failed for", elId, e);
        }
      });
    } catch (e) {
      console.error("initRecaptcha failed", e);
    }
  };

  // Helper to get response for a named widget (register|login|reset)
  window.authRecaptchaGetResponse = function (name) {
    try {
      if (!window._authRecaptchaWidgets) return "";
      var wid = window._authRecaptchaWidgets[name];
      if (
        typeof wid !== "undefined" &&
        typeof grecaptcha.getResponse === "function"
      )
        return grecaptcha.getResponse(wid) || "";
      // fallback: global getResponse
      if (typeof grecaptcha.getResponse === "function")
        return grecaptcha.getResponse() || "";
    } catch (e) {
      return "";
    }
    return "";
  };

  window.authRecaptchaReset = function (name) {
    try {
      if (!window._authRecaptchaWidgets) return;
      var wid = window._authRecaptchaWidgets[name];
      if (typeof wid !== "undefined" && typeof grecaptcha.reset === "function")
        return grecaptcha.reset(wid);
      if (typeof grecaptcha.reset === "function") return grecaptcha.reset();
    } catch (e) {}
  };
})();

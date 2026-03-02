// PSGC Address Dropdown Handler
(function () {
  "use strict";

  // Wait for DOM to be ready
  document.addEventListener("DOMContentLoaded", function () {
    initializeAddressDropdowns();
  });

  function initializeAddressDropdowns() {
    // Register form selects
    const provinceSelect = document.getElementById("register-addressProvince");
    const citySelect = document.getElementById("register-addressCity");
    const barangaySelect = document.getElementById("register-addressBarangay");
    const postalInput = document.getElementById("register-addressPostal");

    // Profile form selects
    const profileProvince = document.getElementById("profile-addressProvince");
    const profileCity = document.getElementById("profile-addressCity");
    const profileBarangay = document.getElementById("profile-addressBarangay");
    const profilePostal = document.getElementById("profile-addressPostal");

    /* ----- REGISTER form initialization ----- */
    if (provinceSelect && citySelect && barangaySelect) {
      // Populate provinces
      populateProvinces(provinceSelect).then(() => {
        try {
          provinceSelect.disabled = false;
          provinceSelect.removeAttribute("disabled");
          provinceSelect.style.pointerEvents = "auto";
        } catch (e) {}
      });

      // Province change handler
      provinceSelect.addEventListener("change", function () {
        const provinceCode = this.value;
        console.debug("PSGC: province changed ->", provinceCode);
        resetSelect(citySelect, "Select City/Municipality");
        resetSelect(barangaySelect, "Select Barangay");
        postalInput.value = "";

        if (provinceCode) {
          populateCities(citySelect, provinceCode).then(() => {
            try {
              citySelect.disabled = false;
              citySelect.removeAttribute("disabled");
              citySelect.style.pointerEvents = "auto";
            } catch (e) {}
          });
        } else {
          try {
            citySelect.disabled = true;
            citySelect.setAttribute("disabled", "");
            citySelect.style.pointerEvents = "none";
          } catch (e) {}
          try {
            barangaySelect.disabled = true;
            barangaySelect.setAttribute("disabled", "");
            barangaySelect.style.pointerEvents = "none";
          } catch (e) {}
        }
      });

      // City change handler
      citySelect.addEventListener("change", async function () {
        const cityCode = this.value;
        console.debug("PSGC: city changed ->", cityCode);

        // Reset barangay
        resetSelect(barangaySelect, "Select Barangay");

        if (!cityCode) {
          postalInput.value = "";
          barangaySelect.disabled = true;
          return;
        }

        // Get city info directly from the fetched cities array
        const raw = await fetchJSON("/api/psgc/cities");
        const cities = normalizeList(raw);

        // Match city object by PSGC or code
        const selectedCity = cities.find((c) => {
          const val = c.psgc_id || c.city_psgc || c.city_code || c.code || "";
          return String(val) === String(cityCode);
        });

        const cityPostal =
          selectedCity?.zip_code ||
          selectedCity?.zipcode ||
          selectedCity?.zip ||
          "";
        postalInput.value = String(cityPostal || "")
          .replace(/\D+/g, "")
          .slice(0, 4);
        console.debug("Postal auto-filled from city object ->", cityPostal);

        // Populate barangays
        try {
          await populateBarangays(barangaySelect, cityCode);
          barangaySelect.disabled = false;
          barangaySelect.removeAttribute("disabled");
          barangaySelect.style.pointerEvents = "auto";
        } catch (e) {
          console.error("PSGC: failed to populate barangays", e);
        }
      });

      // Barangay change handler (postal code comes from barangay)
      barangaySelect.addEventListener("change", function () {
        const selected = this.selectedOptions && this.selectedOptions[0];
        const citySelect = document.querySelector("#register-addressCity");
        const cityPostal =
          citySelect?.selectedOptions[0]?.getAttribute("data-postal") || "";

        if (!selected) {
          document.getElementById("register-addressPostal").value = "";
          return;
        }

        // Prefer barangay data-postal if present, otherwise use cityPostal
        const barangayPostal =
          selected.getAttribute("data-postal") ||
          selected.dataset?.postal ||
          "";
        const finalPostal = String(barangayPostal || cityPostal || "")
          .replace(/\D+/g, "")
          .slice(0, 4);
        document.getElementById("register-addressPostal").value = finalPostal;
        console.debug("Postal auto-filled ->", {
          barangayPostal,
          cityPostal,
          finalPostal,
        });
      });
    }

    /* ----- PROFILE form initialization ----- */
    if (profileProvince) {
      populateProvinces(profileProvince).then(() => {
        try {
          profileProvince.disabled = false;
          profileProvince.removeAttribute("disabled");
          profileProvince.style.pointerEvents = "auto";
        } catch (e) {}
      });

      profileProvince.addEventListener("change", function () {
        const provinceCode = this.value;
        resetSelect(profileCity, "Select City/Municipality");
        resetSelect(profileBarangay, "Select Barangay");
        if (profilePostal) profilePostal.value = "";

        if (provinceCode) {
          populateCities(profileCity, provinceCode).then(() => {
            try {
              profileCity.disabled = false;
              profileCity.removeAttribute("disabled");
              profileCity.style.pointerEvents = "auto";
            } catch (e) {}
          });
        } else {
          try {
            profileCity.disabled = true;
            profileCity.setAttribute("disabled", "");
            profileCity.style.pointerEvents = "none";
          } catch (e) {}
          try {
            profileBarangay.disabled = true;
            profileBarangay.setAttribute("disabled", "");
            profileBarangay.style.pointerEvents = "none";
          } catch (e) {}
        }
      });

      profileCity.addEventListener("change", async function () {
        const cityCode = this.value;
        resetSelect(profileBarangay, "Select Barangay");

        if (!cityCode) {
          if (profilePostal) profilePostal.value = "";
          if (profileBarangay) profileBarangay.disabled = true;
          return;
        }

        const raw = await fetchJSON("/api/psgc/cities");
        const cities = normalizeList(raw);
        const selectedCity = cities.find((c) => {
          const val = c.psgc_id || c.city_psgc || c.city_code || c.code || "";
          return (
            String(val) === String(cityCode) ||
            String(c.name || "").trim() ===
              String(profileCity.dataset.selected || "").trim()
          );
        });
        const cityPostal =
          selectedCity?.zip_code ||
          selectedCity?.zipcode ||
          selectedCity?.zip ||
          "";
        if (profilePostal)
          profilePostal.value = String(cityPostal || "")
            .replace(/\D+/g, "")
            .slice(0, 4);

        try {
          await populateBarangays(profileBarangay, cityCode);
          profileBarangay.disabled = false;
          profileBarangay.removeAttribute("disabled");
          profileBarangay.style.pointerEvents = "auto";
        } catch (e) {
          console.error("PSGC: failed to populate barangays (profile)", e);
        }
      });

      profileBarangay.addEventListener("change", function () {
        const selected = this.selectedOptions && this.selectedOptions[0];
        const citySelect = document.querySelector("#profile-addressCity");
        const cityPostal =
          citySelect?.selectedOptions[0]?.getAttribute("data-postal") || "";

        if (!selected) {
          if (profilePostal) profilePostal.value = "";
          return;
        }

        const barangayPostal =
          selected.getAttribute("data-postal") ||
          selected.dataset?.postal ||
          "";
        const finalPostal = String(barangayPostal || cityPostal || "")
          .replace(/\D+/g, "")
          .slice(0, 4);
        if (profilePostal) profilePostal.value = finalPostal;
      });
    }
  }

  async function fetchJSON(url) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      console.error("PSGC fetch error", url, e);
      return [];
    }
  }

  function normalizeList(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (resp.data && Array.isArray(resp.data)) return resp.data;
    if (resp.results && Array.isArray(resp.results)) return resp.results;
    if (resp.items && Array.isArray(resp.items)) return resp.items;
    // Some endpoints return an object keyed by id — convert values to array
    if (typeof resp === "object")
      return Object.values(resp).filter((v) =>
        Array.isArray(v) ? false : true,
      ).length
        ? []
        : [];
    return [];
  }

  // Use official psgc.cloud endpoints. We fetch provinces once and fetch cities/barangays on demand,
  // matching both PSGC id and correspondence code to handle different code formats.
  async function populateProvinces(selectElement) {
    const raw = await fetchJSON("/api/psgc/provinces");
    const provinces = normalizeList(raw);
    selectElement.innerHTML = '<option value="">Select Province</option>';
    provinces.forEach(function (p) {
      const option = document.createElement("option");
      // store the most likely PSGC/code field as value and keep correspondence code available
      const val =
        p.psgc_id ||
        p.psgc ||
        p.psgc_code ||
        p.code ||
        p.province_psgc ||
        p.province_code ||
        p.id ||
        "";
      option.value = String(val);
      option.textContent =
        p.name || p.province_name || p.psgc_name || p.title || "";
      const corr =
        p.correspondence_code ||
        p.correspondenceCode ||
        p.correspondence ||
        p.correspondenceCode;
      if (corr) option.setAttribute("data-correspondence", corr);
      selectElement.appendChild(option);
    });

    // If a preselected value/text was provided (via data-selected or value), try to select it
    const sel =
      (selectElement.dataset && selectElement.dataset.selected) ||
      selectElement.getAttribute("data-selected") ||
      selectElement.value ||
      "";
    if (sel) {
      const match = Array.from(selectElement.options).find(
        (o) =>
          o.value === String(sel) ||
          o.textContent.trim() === String(sel).trim(),
      );
      if (match) {
        selectElement.value = match.value;
        // trigger change so dependent selects populate
        selectElement.dispatchEvent(new Event("change"));
      }
    }
  }

  function matchByCodes(item, codes) {
    // item: object from cities/barangays; codes: array of strings to match against common fields
    if (!item || !codes || !codes.length) return false;
    const fields = [
      "psgc_id",
      "psgc",
      "city_code",
      "province_code",
      "correspondence_code",
      "correspondenceCode",
      "province_psgc",
      "province_psgc_id",
      "city_psgc",
      "code",
      "barangay_code",
    ];

    for (const code of codes) {
      if (!code) continue;
      // exact field matches
      for (const f of fields) {
        if (item[f] && String(item[f]) === String(code)) return true;
      }

      // prefix match: city/barangay codes usually share a short prefix with province/city PSGC
      const itemCode = String(
        item.code || item.psgc_id || item.city_code || item.barangay_code || "",
      );
      const codeStr = String(code);
      if (itemCode && codeStr) {
        // try common PSGC prefix lengths (5 then 4), e.g., province 0304900000 -> city 0304910000 (match first 5 digits)
        const tryLens = [5, 4];
        for (const n of tryLens) {
          if (
            itemCode.length >= n &&
            codeStr.length >= n &&
            itemCode.slice(0, n) === codeStr.slice(0, n)
          )
            return true;
        }
      }

      // name-based fallback (province or city names)
      const nameFields = [
        "province",
        "city_municipality",
        "city",
        "municipality",
        "name",
      ];
      for (const nf of nameFields) {
        if (
          item[nf] &&
          String(item[nf]).toLowerCase() === codeStr.toLowerCase()
        )
          return true;
      }
    }
    return false;
  }

  async function populateCities(selectElement, provinceCode) {
    const provinceSelect =
      document.querySelector(
        `#${selectElement.id.replace("City", "Province")}`,
      ) || document.querySelector("#register-addressProvince");

    const provCorrespondence = provinceSelect
      ? provinceSelect.selectedOptions[0].getAttribute("data-correspondence") ||
        ""
      : "";

    const codes = [provinceCode];
    if (provCorrespondence) codes.push(provCorrespondence);

    const raw = await fetchJSON("/api/psgc/cities");
    const cities = normalizeList(raw);

    selectElement.innerHTML =
      '<option value="">Select City/Municipality</option>';

    const matches = cities.filter((c) => matchByCodes(c, codes));

    if (!matches.length) {
      const noopt = document.createElement("option");
      noopt.value = "";
      noopt.textContent = "No cities found";
      selectElement.appendChild(noopt);
      selectElement.disabled = true;
      return;
    }

    matches.forEach(function (city) {
      const option = document.createElement("option");

      const val =
        city.psgc_id ||
        city.city_psgc ||
        city.city_code ||
        city.psgc ||
        city.code ||
        city.id ||
        "";

      option.value = String(val);
      option.textContent = city.name || city.city_name || city.title || "";

      /* correspondence */
      const corr =
        city.correspondence_code ||
        city.correspondenceCode ||
        city.correspondence;
      if (corr) option.setAttribute("data-correspondence", corr);

      /* POSTAL CODE: robustly check common postal fields and normalize to 4 chars */
      (function () {
        const candidates = [
          city.zip_code,
          city.postal_code,
          city.zipcode,
          city.zip_code,
          city.postal,
          city.zip,
        ];
        let postal = "";
        for (const p of candidates) {
          if (p !== undefined && p !== null && String(p).trim() !== "") {
            postal = String(p).trim();
            break;
          }
        }
        if (postal) postal = postal.slice(0, 4);
        if (postal) option.setAttribute("data-postal", postal);
        console.debug("PSGC: adding city option", {
          name: option.textContent,
          value: option.value,
          postal,
        });
      })();

      selectElement.appendChild(option);
    });

    selectElement.disabled = false;

    // honor any preselected value/text
    const sel =
      (selectElement.dataset && selectElement.dataset.selected) ||
      selectElement.getAttribute("data-selected") ||
      selectElement.value ||
      "";
    if (sel) {
      const match = Array.from(selectElement.options).find(
        (o) =>
          o.value === String(sel) ||
          o.textContent.trim() === String(sel).trim(),
      );
      if (match) {
        selectElement.value = match.value;
        selectElement.dispatchEvent(new Event("change"));
      }
    }
  }

  async function populateBarangays(selectElement, cityCode) {
    const citySelect =
      document.querySelector(
        `#${selectElement.id.replace("Barangay", "City")}`,
      ) || document.querySelector("#register-addressCity");
    const cityPostal =
      citySelect?.selectedOptions[0]?.getAttribute("data-postal") || "";

    const raw = await fetchJSON(`/api/psgc/barangays?city_code=${cityCode}`);
    const barangays = normalizeList(raw);

    selectElement.innerHTML =
      '<option value="">Select Barangay (optional)</option>';

    barangays.forEach((b) => {
      const option = document.createElement("option");
      option.value = b.psgc_id || b.barangay_code || b.code || "";
      option.textContent = b.name || b.barangay_name || "";

      // Try barangay-level postal fields first, fall back to cityPostal
      (function () {
        const candidates = [
          b.zip_code,
          b.postal_code,
          b.zipcode,
          b.zip_code,
          b.postal,
          b.zip,
        ];
        let postal = "";
        for (const p of candidates) {
          if (p !== undefined && p !== null && String(p).trim() !== "") {
            postal = String(p).trim();
            break;
          }
        }
        if (!postal && cityPostal) postal = String(cityPostal).trim();
        if (postal) postal = postal.slice(0, 4);
        if (postal) option.setAttribute("data-postal", postal);
        console.debug("PSGC: adding barangay option", {
          name: option.textContent,
          value: option.value,
          postal,
        });
      })();

      selectElement.appendChild(option);
    });

    selectElement.disabled = false;

    // honor any preselected value/text
    const sel =
      (selectElement.dataset && selectElement.dataset.selected) ||
      selectElement.getAttribute("data-selected") ||
      selectElement.value ||
      "";
    if (sel) {
      const match = Array.from(selectElement.options).find(
        (o) =>
          o.value === String(sel) ||
          o.textContent.trim() === String(sel).trim(),
      );
      if (match) {
        selectElement.value = match.value;
        selectElement.dispatchEvent(new Event("change"));
      }
    }

    // DON'T auto-select first barangay, leave optional
    // postal is already filled from city
  }

  function resetSelect(selectElement, placeholderText) {
    selectElement.innerHTML = `<option value="">${placeholderText}</option>`;
    selectElement.disabled = true;
  }
})();

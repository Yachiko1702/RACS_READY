// Client-side Booking History (front-end only)
// - Fetches /api/appointments, filters client-side to the current user and renders a responsive list/table
// - Provides search, status/date filters, pagination, view details modal and JSON download

(function () {
  "use strict";

  const root = document.getElementById("bookHistoryRoot");
  if (!root) return;

  const userId = root.getAttribute("data-user-id") || "";
  const userEmail = (root.getAttribute("data-user-email") || "").toLowerCase();

  const perPage = 8;
  let bookings = [];
  let originalBookings = [];
  let filtered = [];
  let page = 0;
  let usingSample = false;

  // UI elements
  const el = {
    loading: document.getElementById("bh-loading"),
    empty: document.getElementById("bh-empty"),
    tableWrap: document.getElementById("bh-table-wrapper"),
    tbody: document.getElementById("bh-tbody"),
    count: document.getElementById("bh-count"),
    prev: document.getElementById("bh-prev"),
    next: document.getElementById("bh-next"),
    search: document.getElementById("bh-search"),
    status: document.getElementById("bh-status"),
    from: document.getElementById("bh-from"),
    to: document.getElementById("bh-to"),
    clear: document.getElementById("bh-clear"),
    showSample: document.getElementById("bh-show-sample"),
    modalElement: document.getElementById("bhDetailModal"),
    modal: null,
    modalBody: document.getElementById("bh-modal-body"),
    downloadJsonBtn: document.getElementById("bh-download-json"),
  };

  function setupModalEnvironment() {
    if (!el.modalElement) return;
    if (el.modalElement.parentElement !== document.body) {
      document.body.appendChild(el.modalElement);
    }
    if (!document.getElementById("bh-modal-fixes")) {
      const css = document.createElement("style");
      css.id = "bh-modal-fixes";
      css.textContent = `
        #bhDetailModal { z-index: 2000 !important; }
        .modal-backdrop { z-index: 1500 !important; backdrop-filter: none !important; }
        #bhDetailModal .modal-content { border: 0; border-radius: 14px; box-shadow: 0 18px 48px rgba(15,23,42,.22); overflow: hidden; }
        #bhDetailModal .modal-header { background: linear-gradient(120deg,#0d6efd,#0a58ca); color: #fff; border-bottom: 0; }
        #bhDetailModal .btn-close { filter: invert(1) grayscale(100%); }
        #bhDetailModal .bh-section { border: 1px solid rgba(15,23,42,.08); border-radius: 10px; background: #fff; padding: 12px 14px; margin-bottom: 10px; }
        #bhDetailModal .bh-section-title { font-size: .78rem; text-transform: uppercase; letter-spacing: .06em; color: #64748b; margin-bottom: 8px; font-weight: 700; }
        #bhDetailModal .bh-kv { display: grid; grid-template-columns: 150px 1fr; gap: 6px 12px; }
        #bhDetailModal .bh-kv .k { color: #64748b; font-weight: 600; font-size: .86rem; }
        #bhDetailModal .bh-kv .v { color: #0f172a; font-size: .9rem; word-break: break-word; }
        #bhDetailModal details summary { cursor: pointer; font-weight: 600; color: #334155; }
      `;
      document.head.appendChild(css);
    }
  }

  setupModalEnvironment();

  function ensureModalInstance() {
    if (el.modal) return el.modal;
    if (!el.modalElement) return null;
    if (window.bootstrap && window.bootstrap.Modal) {
      el.modal = new window.bootstrap.Modal(el.modalElement);
      return el.modal;
    }
    return null;
  }

  function statusBadge(status) {
    const map = {
      pending: "warning",
      confirmed: "success",
      completed: "secondary",
      cancelled: "danger",
      "re-scheduled": "info",
    };
    const cls = map[String(status || "").toLowerCase()] || "secondary";
    return `<span class="badge bg-${cls} text-capitalize">${String(status || "unknown")}</span>`;
  }

  function shortId(id) {
    if (!id) return "-";
    const s = String(id);
    return s.length > 8 ? s.slice(-8) : s;
  }

  function formatDateTime(d) {
    if (!d) return "-";
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return (
      dt.toLocaleDateString() +
      " • " +
      dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  }

  function formatTime(value) {
    if (value === null || value === undefined || value === "") return "-";
    const raw = String(value).trim();

    // already in HH:MM form
    if (/^\d{1,2}:\d{2}$/.test(raw)) {
      const [h, m] = raw.split(":").map((n) => Number(n));
      const d = new Date();
      d.setHours(h, m, 0, 0);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    // minute-of-day numeric string or number
    const mins = Number(raw);
    if (Number.isFinite(mins)) {
      const h = Math.floor(mins / 60) % 24;
      const m = mins % 60;
      const d = new Date();
      d.setHours(h, m, 0, 0);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    // fallback for values like '08:00 AM'
    return raw;
  }

  function renderTable() {
    const start = page * perPage;
    const pageItems = filtered.slice(start, start + perPage);

    el.tbody.innerHTML = pageItems
      .map((b) => {
        const dateText = b.bookingDate
          ? new Date(b.bookingDate).toLocaleDateString()
          : "-";
        const timeText = b.startTime || "-";
        const svc = (b.serviceType || "service") + (b.serviceId ? "" : "");
        const location =
          b.location && b.location.address ? b.location.address : "-";
        return `
        <tr data-id="${b._id}">
          <td><div class="fw-semibold">${shortId(b._id)}</div><div class="small text-muted">Created: ${formatDateTime(b.createdAt)}</div></td>
          <td>${escapeHtml(svc)}</td>
          <td><div class="fw-semibold">${escapeHtml(dateText)}</div><div class="small text-muted">${escapeHtml(timeText)}</div></td>
          <td>${statusBadge(b.status)}</td>
          <td class="text-truncate" style="max-width:220px">${escapeHtml(location)}</td>
          <td class="text-end">
            <div class="btn-group" role="group">
              <button class="btn btn-sm btn-outline-primary bh-view" data-id="${b._id}"><i class="bi bi-eye"></i></button>
              <button class="btn btn-sm btn-outline-secondary bh-download" data-id="${b._id}"><i class="bi bi-download"></i></button>
              <a class="btn btn-sm btn-primary" href="/services" title="Rebook"><i class="bi bi-arrow-repeat"></i></a>
            </div>
          </td>
        </tr>`;
      })
      .join("");

    el.count.textContent = `Showing ${Math.min(filtered.length, start + 1)}–${Math.min(filtered.length, start + perPage)} of ${filtered.length}`;
    el.prev.disabled = page <= 0;
    el.next.disabled = start + perPage >= filtered.length;

    // toggle visibility
    el.loading.classList.add("d-none");
    el.empty.classList.toggle("d-none", filtered.length !== 0);
    el.tableWrap.classList.toggle("d-none", filtered.length === 0);

    attachRowHandlers();
  }

  function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  }

  function attachRowHandlers() {
    document.querySelectorAll(".bh-view").forEach((btn) => {
      btn.onclick = function () {
        const id = this.getAttribute("data-id");
        const b = bookings.find((x) => String(x._id) === String(id));
        if (!b) return;
        showDetailModal(b);
      };
    });

    document.querySelectorAll(".bh-download").forEach((btn) => {
      btn.onclick = function () {
        const id = this.getAttribute("data-id");
        const b = bookings.find((x) => String(x._id) === String(id));
        if (!b) return;
        downloadJSON(b, `booking-${shortId(b._id)}.json`);
      };
    });
  }

  function showDetailModal(b) {
    const serviceName =
      (b.service && b.service.name) ||
      (b.serviceId && b.serviceId.name) ||
      b.serviceType ||
      "Service";
    const bookingRef = b.bookingReference || "—";
    const dateText = b.bookingDate
      ? new Date(b.bookingDate).toLocaleDateString()
      : "—";
    const timeText = b.selectedTimeLabel || b.startTime || "—";
    const occupiedBlock =
      b.startTime && b.endTime ? `${formatTime(b.startTime)} – ${formatTime(b.endTime)}` : "—";
    const techText =
      b.technicianName ||
      (b.technician && b.technician.name) ||
      b.technicianId ||
      "—";
    const locationText = (b.location && b.location.address) || "—";
    const feeText =
      b.estimatedFee != null && b.estimatedFee !== ""
        ? `₱${Number(b.estimatedFee).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "—";

    el.modalBody.innerHTML = `
      <div class="bh-section">
        <div class="bh-section-title">Booking</div>
        <div class="bh-kv">
          <div class="k">Reference</div><div class="v">${escapeHtml(String(bookingRef))}</div>
          <div class="k">Booking ID</div><div class="v"><code>${escapeHtml(String(b._id || "—"))}</code></div>
          <div class="k">Status</div><div class="v">${statusBadge(b.status)}</div>
          <div class="k">Created</div><div class="v">${escapeHtml(formatDateTime(b.createdAt))}</div>
        </div>
      </div>

      <div class="bh-section">
        <div class="bh-section-title">Schedule</div>
        <div class="bh-kv">
          <div class="k">Date</div><div class="v">${escapeHtml(dateText)}</div>
          <div class="k">Selected time</div><div class="v">${escapeHtml(timeText)}</div>
          <div class="k">Occupied block</div><div class="v">${escapeHtml(occupiedBlock)}</div>
          <div class="k">Travel time</div><div class="v">${escapeHtml(b.travelTime != null ? String(b.travelTime) + " min" : "—")}</div>
        </div>
      </div>

      <div class="bh-section">
        <div class="bh-section-title">Service & Assignment</div>
        <div class="bh-kv">
          <div class="k">Service</div><div class="v">${escapeHtml(serviceName)}</div>
          <div class="k">Technician</div><div class="v">${escapeHtml(String(techText))}</div>
          <div class="k">Estimated fee</div><div class="v">${escapeHtml(feeText)}</div>
          <div class="k">Location</div><div class="v">${escapeHtml(locationText)}</div>
        </div>
      </div>

      ${b.notes ? `<div class="bh-section"><div class="bh-section-title">Notes</div><div>${escapeHtml(String(b.notes))}</div></div>` : ""}
    `;

    // wire download button inside modal
    el.downloadJsonBtn.onclick = function () {
      downloadJSON(b, `booking-${shortId(b._id)}.json`);
    };

    const modalInstance = ensureModalInstance();
    if (modalInstance) {
      modalInstance.show();
    } else {
      console.warn(
        "Bootstrap Modal is unavailable. Ensure bootstrap.bundle is loaded before /js/book-history.js",
      );
      alert("Booking details loaded, but modal UI is unavailable right now.");
    }
  }

  function downloadJSON(obj, filename) {
    try {
      const blob = new Blob([JSON.stringify(obj, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "booking.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Download error", e);
    }
  }

  function bookingBelongsToUser(b) {
    if (!b) return false;
    // customerId can be a plain string, ObjectId-like, or an object with _id
    const cidRaw = b.customerId || b.customer_id || b.customer || "";
    const cid =
      cidRaw && typeof cidRaw === "object"
        ? cidRaw._id || (cidRaw.toString && cidRaw.toString())
        : String(cidRaw || "");
    if (cid && userId && String(cid) === String(userId)) return true;
    const cust = String(b.customer || b.customerEmail || "").toLowerCase();
    if (cust && userEmail && cust.indexOf(userEmail) !== -1) return true;
    return false;
  }

  function applyFilters() {
    const q = (el.search.value || "").toLowerCase().trim();
    const status = (el.status.value || "all").toLowerCase();
    const from = el.from.value ? new Date(el.from.value) : null;
    const to = el.to.value ? new Date(el.to.value) : null;
    if (to) {
      to.setHours(23, 59, 59, 999);
    }

    filtered = bookings.filter((b) => {
      // client-side ownership filter
      if (userId && !bookingBelongsToUser(b)) return false;

      // status filter
      if (status !== "all" && String(b.status || "").toLowerCase() !== status)
        return false;

      // date range
      if (from || to) {
        const dt = b.bookingDate
          ? new Date(b.bookingDate)
          : b.createdAt
            ? new Date(b.createdAt)
            : null;
        if (!dt) return false;
        if (from && dt < from) return false;
        if (to && dt > to) return false;
      }

      // search
      if (q) {
        const hay = [
          String(b._id || ""),
          String(b.serviceType || ""),
          String(b.status || ""),
          String(b.notes || ""),
          String(b.technicianId || ""),
          String((b.location && b.location.address) || ""),
        ]
          .join(" ")
          .toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }

      return true;
    });

    // most-recent-first
    filtered.sort(
      (a, b) =>
        new Date(b.bookingDate || b.createdAt) -
        new Date(a.bookingDate || a.createdAt),
    );

    page = 0;
    renderTable();
  }

  function createSampleBookings() {
    const now = new Date();
    const sampleOwnerId = userId || undefined;
    const sampleOwner = userEmail || "guest@example.com";
    return [
      {
        _id: "sample0000000000000001",
        customerId: sampleOwnerId,
        customer: sampleOwner,
        serviceType: "core",
        serviceId: "core-101",
        bookingDate: new Date(
          now.getTime() - 7 * 24 * 3600 * 1000,
        ).toISOString(),
        startTime: "09:00",
        status: "completed",
        location: { address: "Brgy. San Isidro, Sample City" },
        technicianId: "Tech-001",
        createdAt: new Date(now.getTime() - 8 * 24 * 3600 * 1000).toISOString(),
        notes: "Sample completed booking — AC maintenance.",
      },
      {
        _id: "sample0000000000000002",
        customerId: sampleOwnerId,
        customer: sampleOwner,
        serviceType: "repair",
        serviceId: "repair-201",
        bookingDate: new Date(
          now.getTime() + 2 * 24 * 3600 * 1000,
        ).toISOString(),
        startTime: "13:00",
        status: "pending",
        location: { address: "Brgy. Santa Maria, Example Town" },
        technicianId: "Tech-007",
        createdAt: new Date(now.getTime() - 1 * 24 * 3600 * 1000).toISOString(),
        notes: "Sample pending booking — diagnostics.",
      },
      {
        _id: "sample0000000000000003",
        customerId: sampleOwnerId,
        customer: sampleOwner,
        serviceType: "core",
        serviceId: "core-103",
        bookingDate: new Date(
          now.getTime() + 10 * 24 * 3600 * 1000,
        ).toISOString(),
        startTime: "15:30",
        status: "confirmed",
        location: { address: "Brgy. Poblacion, Demo City" },
        technicianId: "Tech-003",
        createdAt: new Date(now.getTime() - 2 * 24 * 3600 * 1000).toISOString(),
        notes: "Sample confirmed booking — installation.",
      },
    ];
  }

  async function fetchBookings() {
    try {
      el.loading.classList.remove("d-none");
      el.tableWrap.classList.add("d-none");
      el.empty.classList.add("d-none");

      const res = await fetch("/api/appointments?limit=1000");
      if (!res.ok) throw new Error("Failed to load");
      const payload = await res.json();
      let items = [];
      if (Array.isArray(payload.items)) items = payload.items;
      else if (Array.isArray(payload)) items = payload;

      bookings = items || [];
      originalBookings = bookings.slice();
      applyFilters();

      // show sample bookings button only when available
      if (el.showSample) el.showSample.classList.remove("d-none");
    } catch (e) {
      console.error("Failed to load bookings", e);
      el.loading.innerHTML =
        '<div class="text-danger">Failed to load bookings. Try reloading the page.</div>';

      // still allow sample demonstration when network fails
      if (el.showSample) el.showSample.classList.remove("d-none");
    }
  }

  // events
  el.search.addEventListener("input", debounce(applyFilters, 250));
  el.status.addEventListener("change", applyFilters);
  el.from.addEventListener("change", applyFilters);
  el.to.addEventListener("change", applyFilters);
  el.clear.addEventListener("click", function () {
    el.search.value = "";
    el.status.value = "all";
    el.from.value = "";
    el.to.value = "";
    applyFilters();
  });

  // sample bookings toggle (front-end only)
  if (el.showSample) {
    el.showSample.addEventListener("click", function () {
      if (!usingSample) {
        bookings = originalBookings.concat(createSampleBookings());
        usingSample = true;
        el.showSample.textContent = "Hide example bookings";
        el.showSample.classList.remove("btn-outline-primary");
        el.showSample.classList.add("btn-outline-secondary");
      } else {
        bookings = originalBookings.slice();
        usingSample = false;
        el.showSample.textContent = "Show example bookings";
        el.showSample.classList.remove("btn-outline-secondary");
        el.showSample.classList.add("btn-outline-primary");
      }
      applyFilters();
    });
  }

  el.prev.addEventListener("click", function () {
    if (page > 0) {
      page--;
      renderTable();
    }
  });
  el.next.addEventListener("click", function () {
    if ((page + 1) * perPage < filtered.length) {
      page++;
      renderTable();
    }
  });

  document.addEventListener("DOMContentLoaded", fetchBookings);

  // helpers
  function debounce(fn, delay) {
    let t;
    return function () {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, arguments), delay);
    };
  }
})();

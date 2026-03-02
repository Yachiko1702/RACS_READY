document
  .getElementById("btn-refresh")
  .addEventListener("click", () => loadDashboard());

async function loadDashboard() {
  try {
    // Prefer a single summary call for dashboard KPIs
    const sRes = await fetch("/api/admin/analytics/summary");
    const s = sRes.ok ? await sRes.json() : {};

    // KPIs
    document.getElementById("kpi-today-appointments").innerText =
      typeof s.todaysAppointments === "number" ? s.todaysAppointments : "—";
    document.getElementById("kpi-pending-bookings").innerText =
      typeof s.pendingBookingRequests === "number"
        ? s.pendingBookingRequests
        : "—";
    document.getElementById("kpi-active-jobs").innerText =
      typeof s.activeJobsInProgress === "number" ? s.activeJobsInProgress : "—";
    document.getElementById("kpi-completed-jobs").innerText =
      typeof s.completedJobsToday === "number" ? s.completedJobsToday : "—";
    document.getElementById("kpi-lowstock").innerText =
      typeof s.lowStockCount === "number" ? s.lowStockCount : "—";
    // revenue: show currency if number, otherwise dash
    const revEl = document.getElementById("kpi-revenue-today");
    if (typeof s.revenueToday === "number") {
      const formatted = s.revenueToday.toLocaleString(undefined, {
        style: "currency",
        currency: s.revenueCurrency || "PHP",
      });
      revEl.innerHTML = `<span class="text-success">${formatted}</span>`;
    } else revEl.innerText = s.revenueToday === null ? "—" : s.revenueToday;

    // Populate today's appointments list (use items from summary if available)
    const ta = document.getElementById("today-appointments");
    if (ta) ta.innerHTML = "";
    const items = s.todaysAppointmentsItems || s.items || [];
    if (items && items.length) {
      items.forEach((it) => {
        const el = document.createElement("div");
        el.className =
          "list-group-item d-flex justify-content-between align-items-start";
        el.innerHTML = `<div><strong>${it.customerName || it.customer || "Customer"}</strong><div class="small text-muted">${it.service || ""} • ${it.time || ""}</div></div><div class="badge bg-secondary">${it.status || ""}</div>`;
        ta.appendChild(el);
      });
    } else if (ta) {
      // fallback to legacy endpoint if summary didn't include items
      try {
        const aRes = await fetch("/api/appointments/today");
        const aData = aRes.ok ? await aRes.json() : {};
        const aItems = aData.items || [];
        if (aItems.length) {
          aItems.forEach((it) => {
            const el = document.createElement("div");
            el.className =
              "list-group-item d-flex justify-content-between align-items-start";
            el.innerHTML = `<div><strong>${it.customerName || it.customer || "Customer"}</strong><div class="small text-muted">${it.service || ""} • ${it.time || ""}</div></div><div class="badge bg-secondary">${it.status || ""}</div>`;
            ta.appendChild(el);
          });
        } else
          ta.innerHTML =
            '<div class="text-muted small">No appointments for today.</div>';
      } catch (e) {
        ta.innerHTML =
          '<div class="text-muted small">No appointments for today.</div>';
      }
    }

    // Low stock items list
    const lsEl = document.getElementById("lowstock-list");
    lsEl.innerHTML = "";
    const lowItems = s.lowStockItems || [];
    if (lowItems && lowItems.length) {
      lowItems.slice(0, 6).forEach((it) => {
        const e = document.createElement("div");
        e.className = "mb-2";
        e.innerHTML = `<strong>${it.name || it.title || it._id}</strong><div class="small text-muted">Stock: ${it.stock || "N/A"}</div>`;
        lsEl.appendChild(e);
      });
    } else if (typeof s.lowStockCount === "number" && s.lowStockCount > 0) {
      lsEl.innerHTML = `<div class="text-muted small">Low stock items: ${s.lowStockCount}</div>`;
    } else
      lsEl.innerHTML =
        '<div class="text-muted small">No low stock items.</div>';

    // Active jobs list
    const ajEl = document.getElementById("active-jobs-list");
    ajEl.innerHTML = "";
    const activeJobs = s.activeJobsItems || [];
    if (activeJobs && activeJobs.length) {
      activeJobs.slice(0, 6).forEach((a) => {
        const n = document.createElement("div");
        n.className = "d-flex justify-content-between align-items-start mb-2";
        const statusClass =
          a.status === "completed" || a.status === "done"
            ? "success"
            : a.status === "confirmed"
              ? "primary"
              : "warning";
        n.innerHTML = `<div><strong>${a.title || "Job"}</strong><div class="small text-muted">Technician: ${a.technicianName || "TBD"} • ${(() => {
          if (a.location && a.location.address) return a.location.address;
          if (
            a.location &&
            a.location.coordinates &&
            Array.isArray(a.location.coordinates.coordinates)
          ) {
            const [lng, lat] = a.location.coordinates.coordinates;
            return lat + ", " + lng;
          }
          return a.location || "";
        })()}</div></div><div class="badge bg-${statusClass}">${a.status || ""}</div>`;
        ajEl.appendChild(n);
      });
    } else
      ajEl.innerHTML = '<div class="text-muted small">No active jobs.</div>';

    // Recent activity logs
    const acts = await fetch("/api/admin/logs?limit=50");
    const actsJson = acts.ok ? await acts.json() : { logs: [] };
    const ra = document.getElementById("recent-activities");
    ra.innerHTML = "";
    const logs = actsJson.logs || [];
    if (logs.length) {
      logs.forEach((l) => {
        const item = document.createElement("div");
        item.className =
          "d-flex justify-content-between align-items-start py-2 border-bottom";
        const left = document.createElement("div");
        left.innerHTML = `<div><strong>${l.actorEmail || "system"}</strong> <span class="text-muted">${l.action}</span></div><div class="small text-muted">${l.details && l.details.reason ? l.details.reason : ""}</div>`;
        const right = document.createElement("div");
        right.className = "small text-muted text-end";
        right.innerText = new Date(l.createdAt).toLocaleString();
        item.appendChild(left);
        item.appendChild(right);
        ra.appendChild(item);
      });
    } else
      ra.innerHTML = '<div class="text-muted small">No recent activity.</div>';

    // Build analytics series (7 days) from available data
    const days = 7;
    const labels = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      labels.push(d.toLocaleDateString());
    }

    // appointments series: if /api/appointments/history or stats exists, prefer it; else derive from today's list or logs
    let appointmentsSeries = Array(days).fill(0);
    try {
      // try analytics endpoint
      const aStats = await fetch("/api/admin/analytics/appointments?days=7");
      if (aStats.ok) {
        const aj = await aStats.json();
        if (Array.isArray(aj.series))
          appointmentsSeries = aj.series.slice(-days);
      } else {
        // fallback: use logs with action containing 'appointment'
        logs.forEach((l) => {
          try {
            const d = new Date(l.createdAt);
            const idx = Math.floor((now - d) / (1000 * 60 * 60 * 24));
            if (idx >= 0 && idx < days && /appoint/i.test(l.action))
              appointmentsSeries[days - 1 - idx]++;
          } catch (e) {}
        });
      }
    } catch (e) {
      console.warn("appointment analytics unavailable", e);
    }

    // customers series: attempt endpoint then fallback to logs with 'register' or 'create user'
    let customersSeries = Array(days).fill(0);
    try {
      const cStats = await fetch("/api/admin/analytics/customers?days=7");
      if (cStats.ok) {
        const cj = await cStats.json();
        if (Array.isArray(cj.series)) customersSeries = cj.series.slice(-days);
      } else {
        logs.forEach((l) => {
          try {
            const d = new Date(l.createdAt);
            const idx = Math.floor((now - d) / (1000 * 60 * 60 * 24));
            if (
              idx >= 0 &&
              idx < days &&
              /register|create user|signup|create account/i.test(l.action)
            )
              customersSeries[days - 1 - idx]++;
          } catch (e) {}
        });
      }
    } catch (e) {
      console.warn("customer analytics unavailable", e);
    }

    // Render charts using Chart.js
    try {
      const apCtx = document
        .getElementById("chart-appointments")
        .getContext("2d");
      if (window._appointmentsChart) window._appointmentsChart.destroy();
      window._appointmentsChart = new Chart(apCtx, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Appointments",
              data: appointmentsSeries,
              borderColor: "#0d6efd",
              backgroundColor: "rgba(13,110,253,0.08)",
              tension: 0.2,
            },
          ],
        },
        options: { responsive: true, plugins: { legend: { display: false } } },
      });

      const cuCtx = document.getElementById("chart-customers").getContext("2d");
      if (window._customersChart) window._customersChart.destroy();
      window._customersChart = new Chart(cuCtx, {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              label: "New Customers",
              data: customersSeries,
              backgroundColor: "#198754",
            },
          ],
        },
        options: { responsive: true, plugins: { legend: { display: false } } },
      });
    } catch (e) {
      console.warn("Chart render failed", e);
    }
  } catch (err) {
    console.error("Dashboard load failed", err);
  }
}

loadDashboard();

// Legacy one-off DOM fetches removed — `loadDashboard()` handles data + charts and the Refresh button.

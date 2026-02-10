'use strict';

const servicesCatalog = {
  services: [
    { name: 'Aircon Installation', duration: 180, price: 3500, icon: 'bi-gear-wide-connected' },
    { name: 'Aircon Cleaning', duration: 90, price: 1200, icon: 'bi-droplet-half' },
    { name: 'Freon Recharging', duration: 60, price: 800, icon: 'bi-lightning-charge' },
    { name: 'Aircon Relocation', duration: 120, price: 2000, icon: 'bi-truck' },
    { name: 'Dismantling & Reinstall', duration: 120, price: 2000, icon: 'bi-nut' },
    { name: 'System Reprocess', duration: 60, price: 1000, icon: 'bi-arrow-repeat' },
    { name: 'Pump Down', duration: 45, price: 700, icon: 'bi-funnel' },
    { name: 'Leak Testing', duration: 45, price: 700, icon: 'bi-activity' },
    { name: 'CCTV Installation', duration: 60, price: 1200, icon: 'bi-shield-lock' }
  ],
  repairs: [
    { name: 'Refrigerator Repair', duration: 90, price: 1200, icon: 'bi-snow' },
    { name: 'Washing Machine', duration: 90, price: 1200, icon: 'bi-droplet' },
    { name: 'Microwave Oven', duration: 60, price: 800, icon: 'bi-radioactive' },
    { name: 'Freezer Service', duration: 90, price: 1200, icon: 'bi-thermometer-snow' },
    { name: 'Dryer Repair', duration: 60, price: 800, icon: 'bi-wind' },
    { name: 'Rice Cooker', duration: 45, price: 700, icon: 'bi-cup-hot' },
    { name: 'Electric Fan', duration: 45, price: 700, icon: 'bi-fan' },
    { name: 'Water Dispenser', duration: 60, price: 800, icon: 'bi-cup-straw' },
    { name: 'Electric Kettle', duration: 30, price: 500, icon: 'bi-lightning' }
  ]
};

const currencyFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0
});

const calendarConfig = buildCalendarConfig();
const suggestionTimeSlots = ['08:00 AM', '10:30 AM', '01:30 PM', '03:30 PM'];
const friendlyDateFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const calendarStatusLabels = {
  available: 'Available slot',
  booked: 'Reserved or already booked',
  blocked: 'Non-working date'
};
const calendarCellFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'long',
  day: 'numeric'
});
const dom = {};
const state = {
  category: null,
  service: null,
  mode: 'manual',
  slot: null,
  suggestion: null,
  calendar: {
    activeMonth: startOfMonth(new Date()),
    selectedDate: null
  }
};

const mapState = {
  element: null,
  map: null,
  markers: {
    technician: null,
    user: null
  },
  technicianCoords: { lat: 14.676049, lng: 121.043731 },
  apiReady: false,
  mounted: false,
  hasAutoGeolocated: false
};

const locationState = {
  userCoords: null
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeServicesPage);
} else {
  initializeServicesPage();
}

function initializeServicesPage() {
  dom.bookingContainer = document.querySelector('.booking-container');
  if (!dom.bookingContainer) {
    window.initServicesMap = () => {};
    return;
  }

  cacheDom();
  hideAdvancedSteps();
  hydrateTechnicianCoords();
  bindCategoryButtons();
  bindModeButtons();
  bindCalendarNavigation();
  renderCalendarDays();
  ensureInitialDate();
  attachLocationHandlers();
}

function cacheDom() {
  dom.serviceCardsWrapper = document.getElementById('serviceCards');
  dom.serviceSelection = document.getElementById('serviceSelection');
  dom.modeSelection = document.getElementById('modeSelection');
  dom.manualCalendar = document.getElementById('manualCalendar');
  dom.suggestedWrapper = document.getElementById('suggestedDates');
  dom.suggestedCards = document.getElementById('suggestedCards');
  dom.locationStep = document.getElementById('locationStep');
  dom.feeStep = document.getElementById('feeStep');
  dom.confirmStep = document.getElementById('confirmStep');
  dom.categoryButtons = Array.from(document.querySelectorAll('.category-btn'));
  dom.modeButtons = Array.from(document.querySelectorAll('.mode-btn'));
  dom.estimatedFee = document.getElementById('estimatedFee');
  dom.timeSelection = document.getElementById('timeSelection');
  dom.timeSlots = document.getElementById('timeSlots');
  dom.timeNotice = document.getElementById('timeNotice');
  dom.calendarGrid = document.getElementById('calendarGrid');
  dom.calendarLabel = document.querySelector('[data-calendar-label]');
  dom.calendarNavButtons = Array.from(document.querySelectorAll('[data-calendar-nav]'));
  dom.locationInput = document.getElementById('locationInput');
  dom.locationStatus = document.getElementById('locationStatus');
  dom.detectLocationBtn = document.getElementById('detectLocationBtn');
  mapState.element = document.getElementById('technicianMap');
}

function hydrateTechnicianCoords() {
  if (!mapState.element) {
    return;
  }
  const { technicianLat, technicianLng } = mapState.element.dataset;
  const lat = parseFloat(technicianLat);
  const lng = parseFloat(technicianLng);
  if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
    mapState.technicianCoords = { lat, lng };
  }
}

function bindCategoryButtons() {
  if (!dom.categoryButtons.length) {
    return;
  }
  dom.categoryButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      dom.categoryButtons.forEach((node) => node.classList.remove('active'));
      btn.classList.add('active');
      state.category = btn.dataset.category;
      state.service = null;
      state.slot = null;
      if (dom.estimatedFee) {
        dom.estimatedFee.textContent = currencyFormatter.format(0);
      }
      hideAdvancedSteps();
      renderServiceCards();
    });
  });
}

function bindModeButtons() {
  if (!dom.modeButtons.length) {
    return;
  }
  dom.modeButtons.forEach((btn) => {
    if (btn.dataset.mode === state.mode) {
      btn.classList.add('active');
    }
    btn.addEventListener('click', () => {
      dom.modeButtons.forEach((node) => node.classList.remove('active'));
      btn.classList.add('active');
      state.mode = btn.dataset.mode;
      toggleScheduleMode();
    });
  });
}

function renderServiceCards() {
  if (!dom.serviceCardsWrapper || !state.category) {
    return;
  }
  dom.serviceSelection.classList.remove('d-none');
  dom.serviceCardsWrapper.innerHTML = '';
  const catalog = servicesCatalog[state.category] || [];
  catalog.forEach((item) => {
    const column = document.createElement('div');
    column.className = 'col-md-4';
    column.innerHTML = `
      <article class="card shadow-sm service-card h-100 p-4 text-center" role="button" tabindex="0">
        <div class="display-6 text-primary mb-3"><i class="bi ${item.icon}"></i></div>
        <h6 class="fw-semibold mb-1">${item.name}</h6>
        <p class="small mb-0">${item.duration} mins · ${currencyFormatter.format(item.price)}</p>
      </article>
    `;
    const card = column.querySelector('.service-card');
    card.addEventListener('click', () => handleServiceSelection(item, card));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleServiceSelection(item, card);
      }
    });
    dom.serviceCardsWrapper.appendChild(column);
  });
}

function handleServiceSelection(item, card) {
  state.service = item;
  state.slot = null;
  state.suggestion = null;
  dom.serviceSelection?.querySelectorAll('.service-card').forEach((node) => node.classList.remove('active'));
  card.classList.add('active');
  if (dom.estimatedFee) {
    dom.estimatedFee.textContent = currencyFormatter.format(item.price);
  }
  ensureInitialDate();
  unlockAdvancedSteps();
}

function hideAdvancedSteps() {
  ['modeSelection', 'suggestedDates', 'manualCalendar', 'locationStep', 'feeStep', 'confirmStep'].forEach((id) => {
    const section = document.getElementById(id);
    if (section && !section.classList.contains('d-none')) {
      section.classList.add('d-none');
    }
  });
}

function unlockAdvancedSteps() {
  ['modeSelection', 'locationStep', 'feeStep', 'confirmStep'].forEach((id) => {
    const section = document.getElementById(id);
    if (section) {
      section.classList.remove('d-none');
    }
  });
  toggleScheduleMode();
  handleLocationStepVisible();
}

function toggleScheduleMode() {
  if (state.mode === 'manual') {
    dom.suggestedWrapper?.classList.add('d-none');
    if (state.service) {
      dom.manualCalendar?.classList.remove('d-none');
    }
    renderCalendarDays();
    return;
  }
  if (state.service) {
    renderSuggestedDates();
  } else {
    dom.suggestedWrapper?.classList.add('d-none');
  }
  dom.manualCalendar?.classList.add('d-none');
  renderCalendarDays();
}

function renderSuggestedDates() {
  if (!dom.suggestedWrapper || !dom.suggestedCards) {
    return;
  }
  if (!state.service) {
    dom.suggestedWrapper.classList.add('d-none');
    dom.suggestedCards.innerHTML = '';
    return;
  }
  const suggestions = buildSuggestedDates();
  dom.suggestedCards.innerHTML = '';
  if (!suggestions.length) {
    dom.suggestedWrapper.classList.remove('d-none');
    dom.suggestedCards.innerHTML = '<div class="col-12"><div class="alert alert-warning">No suggested dates available right now. Please switch to manual calendar.</div></div>';
    return;
  }
  suggestions.forEach((entry, index) => {
    const column = document.createElement('div');
    column.className = 'col-md-4';
    column.innerHTML = `
      <article class="suggested-card h-100" role="button" tabindex="0">
        <div class="d-flex align-items-center justify-content-between mb-2">
          <span class="badge bg-primary-subtle text-primary">AI Pick #${index + 1}</span>
          <i class="bi bi-lightning-charge text-primary"></i>
        </div>
        <h6 class="mb-1">${entry.displayDate}</h6>
        <p class="mb-0 small text-muted">${entry.timeLabel} · ${state.service.duration} mins</p>
      </article>
    `;
    const card = column.querySelector('.suggested-card');
    card.addEventListener('click', () => handleSuggestionSelection(entry, card));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleSuggestionSelection(entry, card);
      }
    });
    if (state.suggestion && formatDateKey(state.suggestion.date) === formatDateKey(entry.date) && state.suggestion.timeLabel === entry.timeLabel) {
      card.classList.add('active');
    }
    dom.suggestedCards.appendChild(column);
  });
  dom.suggestedWrapper.classList.remove('d-none');
}

function handleSuggestionSelection(entry, card) {
  state.calendar.selectedDate = startOfDay(entry.date);
  state.suggestion = entry;
  state.slot = entry.timeLabel;
  state.slotStart = entry.timeStart;
  dom.suggestedCards?.querySelectorAll('.suggested-card').forEach((node) => node.classList.remove('active'));
  card.classList.add('active');
  renderCalendarDays();
  renderTimeSlotsForDate(entry.date);
  // highlight matching time slot if present
  const match = dom.timeSlots?.querySelector(`[data-start="${entry.timeStart}"]`);
  if (match) {
    dom.timeSlots?.querySelectorAll('.time-slot').forEach(n => n.classList.remove('active'));
    match.classList.add('active');
  }
}

function buildSuggestedDates() {
  const results = [];
  let cursor = addDays(calendarConfig.minDate, 1);
  let guard = 0;
  let slotIndex = 0;
  while (results.length < 3 && guard < 120) {
    if (resolveDateStatus(cursor) === 'available') {
      const timeLabel = suggestionTimeSlots[slotIndex % suggestionTimeSlots.length];
      results.push({
        date: startOfDay(cursor),
        displayDate: friendlyDateFormatter.format(cursor),
        timeLabel,
        timeStart: parseAMPMToMinutes(timeLabel)
      });
      slotIndex += 1;
    }
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return results;
}

function ensureInitialDate() {
  if (state.calendar.selectedDate) {
    return;
  }
  const fallback = findNextAvailableDate(calendarConfig.minDate);
  if (fallback) {
    setSelectedDate(fallback);
  }
}

function findNextAvailableDate(startDate) {
  let cursor = startOfDay(new Date(startDate));
  for (let i = 0; i < 60; i += 1) {
    const status = resolveDateStatus(cursor);
    if (status === 'available') {
      return cursor;
    }
    cursor = addDays(cursor, 1);
  }
  return null;
}

function setSelectedDate(date) {
  state.calendar.selectedDate = startOfDay(date);
  state.calendar.activeMonth = startOfMonth(date);
  state.suggestion = null;
  state.slotStart = null;
  if (state.mode === 'manual') {
    state.slot = null;
  }
  renderCalendarDays();
  renderTimeSlotsForDate(date);
}

function bindCalendarNavigation() {
  if (!dom.calendarNavButtons?.length) {
    return;
  }
  dom.calendarNavButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const direction = button.dataset.calendarNav;
      if (direction === 'prev') {
        state.calendar.activeMonth = addMonths(state.calendar.activeMonth, -1);
      } else {
        state.calendar.activeMonth = addMonths(state.calendar.activeMonth, 1);
      }
      renderCalendarDays();
    });
  });
}

function renderCalendarDays() {
  if (!dom.calendarGrid) {
    return;
  }
  dom.calendarGrid.innerHTML = '';
  const monthStart = startOfMonth(state.calendar.activeMonth);
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const leadingEmptySlots = new Date(year, month, 1).getDay();
  for (let i = 0; i < leadingEmptySlots; i += 1) {
    const filler = document.createElement('div');
    filler.className = 'calendar-cell disabled';
    filler.setAttribute('aria-hidden', 'true');
    dom.calendarGrid.appendChild(filler);
  }
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const current = new Date(year, month, day);
    const status = resolveDateStatus(current);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'calendar-cell';
    cell.dataset.status = status;
    cell.textContent = day.toString().padStart(2, '0');
    const labelText = calendarStatusLabels[status] || 'Unavailable';
    const dateLabel = calendarCellFormatter.format(current);
    cell.title = `${dateLabel} · ${labelText}`;
    cell.setAttribute('aria-label', `${dateLabel} – ${labelText}`);
    cell.setAttribute('aria-pressed', 'false');
    if (status !== 'available') {
      cell.classList.add('disabled');
      cell.disabled = true;
      cell.setAttribute('aria-disabled', 'true');
    } else {
      cell.addEventListener('click', () => setSelectedDate(current));
    }
    if (state.calendar.selectedDate && isSameDate(current, state.calendar.selectedDate)) {
      cell.classList.add('is-selected');
      cell.setAttribute('aria-pressed', 'true');
    }
    dom.calendarGrid.appendChild(cell);
  }
  updateCalendarLabel();
}

function updateCalendarLabel() {
  if (!dom.calendarLabel) {
    return;
  }
  const formatter = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
  dom.calendarLabel.textContent = formatter.format(state.calendar.activeMonth);
}

function resolveDateStatus(date) {
  const dateKey = formatDateKey(date);
  if (date < calendarConfig.minDate) {
    return 'blocked';
  }
  if (calendarConfig.bookedDates.has(dateKey)) {
    return 'booked';
  }
  if (calendarConfig.maintenanceDates.has(dateKey)) {
    return 'blocked';
  }
  if (calendarConfig.nonWorkingWeekdays.includes(date.getDay())) {
    return 'blocked';
  }
  return 'available';
}

function handleLocationStepVisible() {
  if (!dom.locationStep || dom.locationStep.classList.contains('d-none')) {
    return;
  }
  attemptMapMount();
  if (mapState.map && window.google) {
    google.maps.event.trigger(mapState.map, 'resize');
    adjustMapViewport();
  }
}

function attachLocationHandlers() {
  if (dom.detectLocationBtn) {
    dom.detectLocationBtn.addEventListener('click', () => attemptGeolocation(true));
  }
  if (dom.locationInput) {
    dom.locationInput.addEventListener('blur', () => {
      const coords = parseCoordinateInput(dom.locationInput.value);
      if (coords) {
        locationState.userCoords = coords;
        placeUserMarker(coords);
        setLocationStatus('Pinned custom coordinates on the map.', 'success');
      }
    });
  }
}

function attemptGeolocation(triggeredByUser = false) {
  if (!navigator.geolocation) {
    setLocationStatus('Geolocation not supported on this browser.', 'danger');
    return;
  }
  setLocationStatus('Detecting your location...', 'info');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const coords = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
      };
      locationState.userCoords = coords;
      if (dom.locationInput) {
        dom.locationInput.value = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
      }
      placeUserMarker(coords);
      setLocationStatus('Location detected. You can fine-tune the pin if needed.', 'success');
    },
    () => {
      setLocationStatus('Unable to fetch your current location. Please enter it manually.', 'danger');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function setLocationStatus(message, tone = 'muted') {
  if (!dom.locationStatus) {
    return;
  }
  dom.locationStatus.className = `location-hint small text-${tone}`;
  dom.locationStatus.textContent = message;
}

function parseCoordinateInput(value) {
  if (!value || !value.includes(',')) {
    return null;
  }
  const [latRaw, lngRaw] = value
    .split(',')
    .map((part) => parseFloat(part.trim()));
  if (Number.isNaN(latRaw) || Number.isNaN(lngRaw)) {
    return null;
  }
  return { lat: latRaw, lng: lngRaw };
}

function placeUserMarker(coords) {
  if (!window.google || !mapState.element) {
    return;
  }
  if (!mapState.map) {
    return;
  }
  if (!mapState.markers.user) {
    mapState.markers.user = new google.maps.Marker({
      map: mapState.map,
      icon: 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png',
      title: 'Your location'
    });
  }
  mapState.markers.user.setPosition(coords);
  adjustMapViewport();
}

// Helpers for time slot rendering
function minutesTo12HourLabel(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${String(hour12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

function parseAMPMToMinutes(label) {
  // expected formats: '08:00 AM' or '8:00 AM'
  const parts = label.trim().split(/\s+/);
  if (parts.length < 2) return 0;
  const [timePart, ampm] = parts;
  const [hh, mm] = timePart.split(':').map(n => parseInt(n, 10));
  let hours = hh % 12;
  if (ampm.toUpperCase() === 'PM') hours += 12;
  return hours * 60 + (isNaN(mm) ? 0 : mm);
}

function renderTimeSlotsForDate(date) {
  if (!dom.timeSelection || !dom.timeSlots) return;
  dom.timeSlots.innerHTML = '';
  const status = resolveDateStatus(date);
  if (status !== 'available') {
    dom.timeSelection.classList.add('d-none');
    dom.timeNotice.textContent = status === 'booked' ? 'This date is already reserved.' : 'No time slots available for this date.';
    return;
  }
  const duration = state.service?.duration || 60;
  const blocks = [ { start: 8 * 60, end: 12 * 60 }, { start: 13 * 60, end: 17 * 60 } ];
  let any = false;
  blocks.forEach(block => {
    for (let t = block.start; t + duration <= block.end; t += 30) {
      any = true;
      const startLabel = minutesTo12HourLabel(t);
      const endLabel = minutesTo12HourLabel(t + duration);
      const label = `${startLabel} - ${endLabel}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'time-slot btn btn-sm';
      btn.textContent = label;
      btn.dataset.start = String(t);
      btn.addEventListener('click', () => {
        dom.timeSlots.querySelectorAll('.time-slot').forEach(n => n.classList.remove('active'));
        btn.classList.add('active');
        state.slot = label;
        state.slotStart = t;
        if (dom.estimatedFee && state.service) {
          dom.estimatedFee.textContent = currencyFormatter.format(state.service.price);
        }
      });
      dom.timeSlots.appendChild(btn);
    }
  });
  if (!any) {
    dom.timeSelection.classList.add('d-none');
    dom.timeNotice.textContent = 'No time slots found for this date.';
    return;
  }
  dom.timeSelection.classList.remove('d-none');
  dom.timeNotice.textContent = '';
  // auto-activate if there's a suggestion for this date
  if (state.suggestion && isSameDate(state.suggestion.date, date)) {
    const match = dom.timeSlots.querySelector(`[data-start="${state.suggestion.timeStart}"]`);
    if (match) {
      match.classList.add('active');
    }
  }
}

function adjustMapViewport() {
  if (!mapState.map || !window.google) {
    return;
  }
  const bounds = new google.maps.LatLngBounds();
  if (mapState.markers.technician) {
    bounds.extend(mapState.markers.technician.getPosition());
  }
  if (mapState.markers.user) {
    bounds.extend(mapState.markers.user.getPosition());
  }
  if (!bounds.isEmpty()) {
    mapState.map.fitBounds(bounds, 80);
  }
}

window.initServicesMap = function initServicesMap() {
  mapState.apiReady = true;
  handleLocationStepVisible();
};

function attemptMapMount() {
  if (mapState.map || !mapState.apiReady) {
    return;
  }
  if (!dom.locationStep || dom.locationStep.classList.contains('d-none')) {
    return;
  }
  mapState.element = mapState.element || document.getElementById('technicianMap');
  if (!mapState.element || !window.google) {
    return;
  }
  mapState.map = new google.maps.Map(mapState.element, {
    center: mapState.technicianCoords,
    zoom: 13,
    mapTypeControl: false,
    fullscreenControl: false,
    streetViewControl: false,
    styles: [
      { elementType: 'geometry', stylers: [{ color: '#f5f5f5' }] },
      { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
      { elementType: 'labels.text.fill', stylers: [{ color: '#616161' }] },
      { featureType: 'poi.business', stylers: [{ visibility: 'off' }] }
    ]
  });
  mapState.markers.technician = new google.maps.Marker({
    position: mapState.technicianCoords,
    map: mapState.map,
    icon: 'http://maps.google.com/mapfiles/ms/icons/green-dot.png',
    title: 'Nearest technician'
  });
  if (locationState.userCoords) {
    placeUserMarker(locationState.userCoords);
  }
  mapState.mounted = true;
  adjustMapViewport();
  if (!mapState.hasAutoGeolocated) {
    attemptGeolocation(false);
    mapState.hasAutoGeolocated = true;
  }
}

function buildCalendarConfig() {
  const baseDate = startOfDay(new Date());
  const bookedOffsets = [2, 4, 7, 11, 18];
  const maintenanceOffsets = [3, 9, 15, 21];
  return {
    minDate: baseDate,
    nonWorkingWeekdays: [0],
    bookedDates: new Set(bookedOffsets.map((offset) => formatDateKey(addDays(baseDate, offset)))),
    maintenanceDates: new Set(maintenanceOffsets.map((offset) => formatDateKey(addDays(baseDate, offset))))
  };
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDays(date, amount) {
  const clone = new Date(date);
  clone.setDate(clone.getDate() + amount);
  return clone;
}

function addMonths(date, amount) {
  const clone = new Date(date);
  clone.setMonth(clone.getMonth() + amount);
  return startOfMonth(clone);
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isSameDate(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function toTimeRangeLabel(startMinutes, endMinutes) {
  const start = minutesToTime(startMinutes);
  const end = minutesToTime(endMinutes);
  return `${start} - ${end}`;
}

function minutesToTime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

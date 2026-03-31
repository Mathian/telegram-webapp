/* ============================================================
   APP — Boot, screen management, tabs, UI updates
   ============================================================ */

// ---- Boot ----
window.addEventListener('DOMContentLoaded', () => {
  loadState();
  initFirebase();
  buildDateScroll();
  buildTimeWheel();

  // Complaint checkbox
  const cc = document.getElementById('complaint-check');
  if (cc) {
    cc.addEventListener('change', function () {
      const cw = document.getElementById('complaint-wrap');
      if (cw) cw.style.display = this.checked ? 'block' : 'none';
    });
  }

  // Close modals on backdrop click
  document.querySelectorAll('.mo').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });

  // Close autocomplete on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('.autocomplete-wrap')) {
      document.querySelectorAll('.autocomplete-list').forEach(l => l.classList.remove('open'));
    }
  });

  // Support chat enter key
  const supportInput = document.getElementById('support-input');
  if (supportInput) {
    supportInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendSupportMsg(); });
  }

  // Load app settings (bonus system, TON wallet, etc.)
  loadAppSettings();

  // Boot sequence
  setTimeout(() => {
    _show('s-splash', false);
    document.getElementById('s-splash').classList.remove('active');
    if (STATE.registered && STATE.user) {
      initMain();
    } else {
      prefillTg();
      showScreen('s-onboard');
    }
  }, 1800);
});

// ---- Firebase-ready init ----
async function initMain() {
  showLoading(true);
  // Refresh user data from Firebase
  if (isFirebaseReady && STATE.user && STATE.user.tgId) {
    try {
      const fresh = await dbGet('users', STATE.user.tgId);
      if (fresh) { STATE.user = { ...STATE.user, ...fresh }; saveState(); }
    } catch (e) { console.warn('[initMain] reload:', e); }
  }
  showLoading(false);
  updateAllUI();
  if (STATE.role === 'passenger') {
    showScreen('s-passenger');
    setupPassengerListeners();
  } else {
    showScreen('s-driver');
    setupDriverListeners();
  }
  updateOnlineCount();
}

// ---- Screen transitions ----
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

// ---- UI: update all UI elements ----
function updateAllUI() {
  if (!STATE.user) return;
  const u = STATE.user;
  _setText('p-hdr-name', u.name.split(' ')[0]);
  _setText('pp-name', u.name);
  _setText('pp-phone', u.phone);
  _setText('pp-city', (u.city || '') + (u.countryName ? ', ' + u.countryName : ''));
  _setText('pp-trips', u.passengerTrips || u.trips || 0);
  _setText('pp-rating', fmtRating(u.rating));
  _setText('d-hdr-name', u.name.split(' ')[0]);
  _setText('dp-name', u.name);
  _setText('dp-phone', u.phone);
  if (u.car) _setText('dp-car', `${u.car.color} ${u.car.brand} ${u.car.year} · ${u.car.num}`);
  _setText('dp-trips', u.driverTrips || u.trips || 0);
  _setText('dp-rating', fmtRating(u.rating));
  _setText('dp-shift-trips', STATE.shiftTrips || 0);
  updateTonStatus();
}

function updateTonStatus() {
  const u = STATE.user;
  if (!u || u.role !== 'driver') return;
  const freeUntil = u.freeUntil ? new Date(u.freeUntil) : null;
  const isFree = freeUntil && freeUntil > new Date();
  const el = document.getElementById('dp-ton-desc');
  if (el) {
    el.textContent = isFree
      ? `Бесплатный период до ${fmtDate(freeUntil.toISOString())}. После — 500₸/день.`
      : 'Бесплатный период истёк. Оплачивайте каждую смену через TON.';
  }
  const warn = document.getElementById('d-pay-warning');
  if (warn) warn.style.display = isFree ? 'none' : 'block';
}

// ---- Tabs: passenger ----
function pTab(n) {
  [0, 1, 2].forEach(i => {
    const ni = document.getElementById('p-ni-' + i);
    if (ni) ni.classList.toggle('on', i === n);
  });

  // Hide all content
  ['p-new-order', 'p-searching', 'p-active-ride', 'p-hist-content', 'p-prof-content'].forEach(id => _show(id, false));

  if (n === 0) {
    // Orders tab — show correct state
    if (STATE.activeOrderId) {
      checkActiveOrderStatus();
    } else {
      _show('p-new-order', true);
    }
  } else if (n === 1) {
    _show('p-hist-content', true);
    renderPHistory();
  } else if (n === 2) {
    _show('p-prof-content', true);
    updateAllUI();
  }
}

// ---- Tabs: driver ----
function dTab(n) {
  [0, 1, 2].forEach(i => {
    const ni = document.getElementById('d-ni-' + i);
    if (ni) ni.classList.toggle('on', i === n);
  });
  _show('d-orders-tab', n === 0);
  _show('d-hist-tab', n === 1);
  _show('d-prof-tab', n === 2);
  if (n === 0) updateDriverUI();
  if (n === 1) renderDHistory();
  if (n === 2) updateAllUI();
}

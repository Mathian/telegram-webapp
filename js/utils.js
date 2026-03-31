/* ============================================================
   UTILS — Formatters, Toast, Loading, Modal helpers
   ============================================================ */

// ---- Telegram WebApp ----
const tg = (window.Telegram && window.Telegram.WebApp) || {
  initDataUnsafe: { user: { id: Date.now(), first_name: 'Пользователь', username: 'user' } },
  ready: () => {},
  expand: () => {},
  sendData: d => console.log('[TG]', d),
  MainButton: { show: () => {}, hide: () => {}, setText: () => {}, onClick: () => {}, offClick: () => {} },
  HapticFeedback: { impactOccurred: () => {}, notificationOccurred: () => {} },
  showAlert: (t, cb) => { alert(t); if (cb) cb(); },
  showConfirm: (t, cb) => { cb(confirm(t)); },
  close: () => {}
};
tg.ready();
tg.expand();

// ---- Formatters ----
function fmtPrice(n) { return n ? Number(n).toLocaleString('ru') : '0'; }
function fmtRating(r) { return r ? Number(r).toFixed(1) : '—'; }
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateShort(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}
function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
function fmtRelTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso);
  if (diff < 60000) return 'только что';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' мин назад';
  return fmtTime(iso);
}

// ---- Toast ----
let _toastTimer = null;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

// ---- Loading overlay ----
function showLoading(v) {
  const el = document.getElementById('loading-overlay');
  if (el) el.classList.toggle('show', v);
}

// ---- Modals ----
function openModal(id) {
  // Settings modal — pre-fill fields
  if (id === 'mo-settings' && STATE.user) {
    const u = STATE.user;
    _setVal('set-name', u.name || '');
    _setVal('set-country-input', u.countryName || '');
    _setVal('set-country', u.country || '');
    _setVal('set-city-input', u.city || '');
    _setVal('set-city', u.city || '');
    const bdb = document.getElementById('become-driver-block');
    const edb = document.getElementById('edit-car-block');
    if (bdb) bdb.style.display = (u.role === 'passenger' && !u.appliedForDriverAt) ? 'block' : 'none';
    if (edb) edb.style.display = u.role === 'driver' ? 'block' : 'none';
    if (u.car && edb) {
      _setVal('edit-car-brand', u.car.brand || '');
      _setVal('edit-car-year', u.car.year || '');
      _setVal('edit-car-num', u.car.num || '');
      _setVal('edit-car-color', u.car.color || '');
    }
  }
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

// ---- Autocomplete country/city ----
function acCountry(val, prefix) {
  const list = document.getElementById(`ac-country-${prefix}`);
  if (!list) return;
  const filtered = Object.keys(COUNTRIES).filter(c =>
    c.toLowerCase().includes(val.toLowerCase())
  );
  if (!filtered.length || !val) { list.classList.remove('open'); return; }
  list.innerHTML = filtered.slice(0, 8).map(c =>
    `<div class="ac-item" onclick="selectCountry('${c}','${prefix}')">${COUNTRIES[c].flag} ${c}</div>`
  ).join('');
  list.classList.add('open');
}

function selectCountry(name, prefix) {
  _setVal(`${prefix}-country-input`, name);
  _setVal(`${prefix}-country`, COUNTRIES[name].code);
  document.getElementById(`ac-country-${prefix}`).classList.remove('open');
  // Reset city
  _setVal(`${prefix}-city-input`, '');
  _setVal(`${prefix}-city`, '');
}

function acCity(val, prefix) {
  const countryCode = document.getElementById(`${prefix}-country`) ? document.getElementById(`${prefix}-country`).value : '';
  const countryName = document.getElementById(`${prefix}-country-input`) ? document.getElementById(`${prefix}-country-input`).value : '';
  let cities = [];
  if (countryCode) {
    const entry = Object.values(COUNTRIES).find(c => c.code === countryCode);
    if (entry) cities = entry.cities;
  } else if (countryName) {
    const entry = COUNTRIES[countryName];
    if (entry) cities = entry.cities;
  } else {
    cities = Object.values(COUNTRIES).flatMap(c => c.cities);
  }
  const filtered = val ? cities.filter(c => c.toLowerCase().includes(val.toLowerCase())) : cities;
  const list = document.getElementById(`ac-city-${prefix}`);
  if (!list) return;
  if (!filtered.length) { list.classList.remove('open'); return; }
  list.innerHTML = filtered.slice(0, 10).map(c =>
    `<div class="ac-item" onclick="selectCity('${c}','${prefix}')">${c}</div>`
  ).join('');
  list.classList.add('open');
}

function selectCity(name, prefix) {
  _setVal(`${prefix}-city-input`, name);
  _setVal(`${prefix}-city`, name);
  const list = document.getElementById(`ac-city-${prefix}`);
  if (list) list.classList.remove('open');
}

// ---- Helpers ----
function _setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function _setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function _show(id, show = true) {
  const el = document.getElementById(id);
  if (el) el.style.display = show ? '' : 'none';
}

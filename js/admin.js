/* ============================================================
   ADMIN — Firebase config, auth, dashboard, drivers, passengers,
           orders, intercity, support chat, settings
   ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyDnH2Uz70mnGuQ85WzNAOsUmgGYqXwfGcg",
  authDomain: "telegram-taxi-20164.firebaseapp.com",
  projectId: "telegram-taxi-20164",
  storageBucket: "telegram-taxi-20164.firebasestorage.app",
  messagingSenderId: "713264125968",
  appId: "1:713264125968:web:258e0e18654cbdf2ea9295"
};

let db = null, isFirebaseReady = false;
let currentChatId = null, unsubChat = null;
let allDrivers = [], allOrders = [], allPassengers = [], appSettings = {};
let driverFilter = 'all', orderFilter = 'all';
let _driverSearch = '', _passengerSearch = '', _orderSearch = '', _disputeSearch = '';
let allUsers = [], userFilter = 'all', _userSearch = '';
let _dashPeriod = 'today';
let _currentUD = null, _udPeriod = 'today', _allOrdersCache = null;

// ============================================================
// INIT
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  initFirebase();
});

function initFirebase() {
  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    isFirebaseReady = true;
    firebase.auth().onAuthStateChanged(user => {
      if (user) {
        showAdmin();
      } else {
        document.getElementById('admin-screen').style.display = 'none';
        document.getElementById('mob-header').style.display = 'none';
        document.getElementById('login-screen').style.display = 'flex';
      }
    });
  } catch (e) { console.error('Firebase error:', e); }
}

// ============================================================
// AUTH
// ============================================================
async function doLogin() {
  const email = document.getElementById('login-user').value.trim();
  const pass  = document.getElementById('login-pass').value;
  if (!email || !pass) { showToast('Введите email и пароль', 'err'); return; }
  const btn = document.querySelector('#login-screen .btn');
  if (btn) btn.disabled = true;
  try {
    await firebase.auth().signInWithEmailAndPassword(email, pass);
  } catch (e) {
    const msgs = {
      'auth/invalid-email':     'Неверный формат email',
      'auth/user-not-found':    'Пользователь не найден',
      'auth/wrong-password':    'Неверный пароль',
      'auth/invalid-credential':'Неверный email или пароль',
      'auth/too-many-requests': 'Слишком много попыток. Подождите.',
    };
    showToast(msgs[e.code] || 'Ошибка входа: ' + e.message, 'err');
    document.getElementById('login-pass').value = '';
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function logout() {
  await firebase.auth().signOut();
}

function showAdmin() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('admin-screen').style.display = 'block';
  document.getElementById('mob-header').style.display = 'flex';
  loadDashboard();
  loadSettings();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('mob-open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}

// ============================================================
// NAVIGATION
// ============================================================
function showPage(page) {
  // Close mobile sidebar on navigation
  document.getElementById('sidebar').classList.remove('mob-open');
  document.getElementById('sidebar-overlay').classList.remove('open');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pg = document.getElementById('page-' + page);
  const nav = document.getElementById('nav-' + page);
  if (pg) pg.classList.add('active');
  if (nav) nav.classList.add('active');
  if (page === 'dashboard') loadDashboard();
  else if (page === 'users') loadUsers();
  else if (page === 'orders') loadOrders();
  else if (page === 'intercity') loadIntercity();
  else if (page === 'support') loadSupportChats();
  else if (page === 'disputes') loadDisputes();
  else if (page === 'settings') loadSettings();
}

// ============================================================
// DATA HELPERS
// ============================================================
async function getAllFromFirebase(collection) {
  if (!isFirebaseReady) return [];
  try {
    const snap = await db.collection(collection).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn(`getAll(${collection}) error:`, e.message);
    return [];
  }
}

async function getAllUsers() {
  const fbUsers = await getAllFromFirebase('users');
  const lsUsers = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith('tt_users_')) continue;
    try {
      const doc = JSON.parse(localStorage.getItem(key));
      if (doc && !fbUsers.find(u => u.id === key.replace('tt_users_', ''))) {
        lsUsers.push({ id: key.replace('tt_users_', ''), ...doc });
      }
    } catch (e) {}
  }
  return [...fbUsers, ...lsUsers];
}

async function getAllOrders() {
  const fbOrders = await getAllFromFirebase('orders');
  const lsOrders = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith('tt_orders_')) continue;
    try {
      const doc = JSON.parse(localStorage.getItem(key));
      if (doc && !fbOrders.find(o => o.id === key.replace('tt_orders_', ''))) {
        lsOrders.push({ id: key.replace('tt_orders_', ''), ...doc });
      }
    } catch (e) {}
  }
  return [...fbOrders, ...lsOrders];
}

async function updateDoc(col, docId, data) {
  if (!isFirebaseReady) { showToast('Firebase не подключён. Данные сохранены локально.', 'err'); return; }
  try {
    await db.collection(col).doc(String(docId)).set({ ...data, _updatedAt: new Date().toISOString() }, { merge: true });
  } catch (e) {
    showToast('Ошибка сохранения: ' + e.message, 'err');
  }
}

// ============================================================
// DASHBOARD
// ============================================================
function getPeriodRange(period, from, to) {
  const now = new Date();
  if (period === 'today') {
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { start: s, end: new Date(s.getTime() + 86400000) };
  }
  if (period === 'week') return { start: new Date(now.getTime() - 7 * 86400000), end: now };
  if (period === 'month') {
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
  }
  if (period === 'range' && from && to) {
    const end = new Date(to); end.setHours(23, 59, 59, 999);
    return { start: new Date(from), end };
  }
  return { start: new Date(0), end: new Date(9999999999999) };
}

function setDashPeriod(p) {
  _dashPeriod = p;
  ['today', 'all', 'range'].forEach(id => document.getElementById('dp-' + id)?.classList.remove('on'));
  document.getElementById('dp-' + p)?.classList.add('on');
  const rangeRow = document.getElementById('dp-range-row');
  if (rangeRow) rangeRow.style.display = p === 'range' ? 'flex' : 'none';
  if (p !== 'range') loadDashboard();
}

function _dashPeriodLabel() {
  if (_dashPeriod === 'today') return 'сегодня';
  if (_dashPeriod === 'all')   return 'за всё время';
  const f = document.getElementById('dp-from')?.value;
  const t = document.getElementById('dp-to')?.value;
  if (f && t) return `${f} — ${t}`;
  return 'за период';
}

async function loadDashboard() {
  document.getElementById('dash-updated').textContent = 'Загрузка...';
  const users = await getAllUsers();
  const orders = await getAllOrders();
  _allOrdersCache = orders;
  const shifts = await getAllFromFirebase('driver_shifts');

  const drivers = users.filter(u => u.role === 'driver');
  const pending = drivers.filter(d => d.approved === false && !d.blocked && !d.blockedAsDriver && !d.tempBlocked);
  const now = new Date();
  const onlineShifts = shifts.filter(s => s.active && new Date(s.until) > now);

  // All-time stats
  const ordersDoneAll = orders.filter(o => o.status === 'done');
  const earningsAll     = orders.reduce((s, o) => s + Number(o.acceptedPrice || o.price || 0), 0);
  const earningsAllDone = ordersDoneAll.reduce((s, o) => s + Number(o.acceptedPrice || o.price || 0), 0);

  // Period stats
  const dpFrom = document.getElementById('dp-from')?.value;
  const dpTo   = document.getElementById('dp-to')?.value;
  const range  = getPeriodRange(_dashPeriod, dpFrom, dpTo);
  const ordersInPeriod = orders.filter(o => { const d = new Date(o.createdAt); return d >= range.start && d < range.end; });
  const ordersPeriodDone = ordersInPeriod.filter(o => o.status === 'done');
  const earningsPeriod     = ordersInPeriod.reduce((s, o) => s + Number(o.acceptedPrice || o.price || 0), 0);
  const earningsPeriodDone = ordersPeriodDone.reduce((s, o) => s + Number(o.acceptedPrice || o.price || 0), 0);

  const lbl = _dashPeriodLabel();

  document.getElementById('st-users').textContent = users.length;
  document.getElementById('st-drivers').textContent = drivers.length;
  document.getElementById('st-online').textContent = onlineShifts.length;
  document.getElementById('st-pending').textContent = pending.length;
  document.getElementById('st-orders-total').textContent = orders.length;
  document.getElementById('st-orders-done').textContent = ordersDoneAll.length;
  document.getElementById('st-earn-all').textContent = fmtPrice(earningsAll) + '₸';
  document.getElementById('st-earn-done').textContent = fmtPrice(earningsAllDone) + '₸';
  document.getElementById('st-orders-today').textContent = ordersInPeriod.length;
  document.getElementById('st-orders-today-done').textContent = ordersPeriodDone.length;
  document.getElementById('st-earn-today').textContent = fmtPrice(earningsPeriod) + '₸';
  document.getElementById('st-earn-today-done').textContent = fmtPrice(earningsPeriodDone) + '₸';
  document.getElementById('lbl-orders-today')?.setAttribute('data-base', 'Заявок');
  document.getElementById('lbl-orders-today-done')?.setAttribute('data-base', 'Завершено');
  document.getElementById('lbl-earn-today')?.setAttribute('data-base', 'Сумма заявок');
  document.getElementById('lbl-earn-today-done')?.setAttribute('data-base', 'Сумма завершённых');
  ['lbl-orders-today','lbl-orders-today-done','lbl-earn-today','lbl-earn-today-done'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = (el.getAttribute('data-base') || '') + ' ' + lbl;
  });
  document.getElementById('dash-updated').textContent = 'Обновлено: ' + new Date().toLocaleTimeString('ru-RU');

  const pendingSection = document.getElementById('dash-pending-section');
  if (pendingSection) pendingSection.style.display = pending.length > 0 ? 'block' : 'none';

  if (pending.length > 0) {
    const badge = document.getElementById('nav-pending-badge');
    badge.textContent = pending.length; badge.style.display = 'inline';
  }

  // Load disputes badge in background
  try {
    const disputes = await getAllFromFirebase('disputes');
    const pendingDisputes = disputes.filter(d => d.status === 'pending').length;
    const dbadge = document.getElementById('nav-disputes-badge');
    if (dbadge) { dbadge.textContent = pendingDisputes; dbadge.style.display = pendingDisputes > 0 ? '' : 'none'; }
  } catch (_) {}

  const recent = orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8);
  const recentEl = document.getElementById('dash-recent-orders');
  if (!recent.length) { recentEl.innerHTML = '<div class="empty">Заказов ещё нет</div>'; return; }
  recentEl.innerHTML = `<table>
    <thead><tr><th>Пассажир</th><th>Маршрут</th><th>Цена</th><th>Водитель</th><th>Статус</th><th>Дата</th></tr></thead>
    <tbody>${recent.map(o => `
      <tr>
        <td><div style="font-weight:700">${o.passengerName || '—'}</div><div style="font-size:11px;color:var(--text3)">${o.passengerPhone || ''}</div></td>
        <td style="max-width:180px"><div style="font-size:12px">${o.from || '—'}</div><div style="font-size:12px;color:var(--text3)">→ ${o.to || '—'}</div></td>
        <td style="font-weight:700;color:var(--y)">${fmtPrice(o.price)}₸</td>
        <td>${o.acceptedDriver ? o.acceptedDriver.name : '—'}</td>
        <td>${statusBadge(o.status)}</td>
        <td style="color:var(--text3);font-size:11px">${fmtDate(o.createdAt)}</td>
      </tr>`).join('')}</tbody>
  </table>`;
}

// ============================================================
// USERS (объединяет водителей и пассажиров)
// ============================================================
async function loadUsers() {
  document.getElementById('users-tbody').innerHTML = '<tr><td colspan="7" class="empty">⏳ Загрузка...</td></tr>';
  allUsers = await getAllUsers();
  _allOrdersCache = null; // сбрасываем кеш заказов при обновлении
  renderUsers();
  const pending = allUsers.filter(u => (u.role === 'driver' || u.car) && u.approved === false && !u.blocked && !u.blockedAsDriver && !u.tempBlocked);
  const badge = document.getElementById('nav-pending-badge');
  if (badge) { badge.textContent = pending.length; badge.style.display = pending.length ? 'inline' : 'none'; }
}

function filterUsers(f) {
  userFilter = f;
  document.querySelectorAll('[id^="uf-"]').forEach(el => el.classList.remove('on'));
  document.getElementById('uf-' + f)?.classList.add('on');
  renderUsers();
}

function searchUsers(q) { _userSearch = q.trim().toLowerCase(); renderUsers(); }

function renderUsers() {
  let list = allUsers;

  if (userFilter === 'drivers')    list = list.filter(u => u.role === 'driver' || !!u.car);
  else if (userFilter === 'passengers') list = list.filter(u => u.role === 'passenger' && !u.car);
  else if (userFilter === 'pending')    list = list.filter(u => (u.role === 'driver' || u.car) && u.approved === false && !u.blocked && !u.blockedAsDriver && !u.tempBlocked);
  else if (userFilter === 'blocked')    list = list.filter(u => u.blocked || u.blockedAsDriver || u.blockedAsPassenger || u.tempBlocked);

  if (_userSearch) {
    const q = _userSearch;
    list = list.filter(u =>
      (u.name  || '').toLowerCase().includes(q) ||
      (u.phone || '').toLowerCase().includes(q) ||
      (u.city  || '').toLowerCase().includes(q)
    );
  }
  list = list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const tbody = document.getElementById('users-tbody');
  if (!list.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty">Нет пользователей</td></tr>'; return; }

  tbody.innerHTML = list.map(u => {
    const id = u.id || u.tgId;
    const isDriver = u.role === 'driver' || !!u.car;
    const isAdminBlocked = u.tempBlocked && u.tempBlockReason === 'admin';

    // Статус водителя
    let drvBadge = '';
    if (isDriver) {
      if (u.blocked || u.blockedAsDriver || isAdminBlocked)
        drvBadge = `<span class="badge b-red">🚫 Вод.</span>`;
      else if (u.tempBlocked)
        drvBadge = `<span class="badge b-orange">🔒 Авто-блок (вод.)</span>`;
      else if (u.approved === false)
        drvBadge = `<span class="badge b-yellow">⏳ На проверке</span>`;
      else
        drvBadge = `<span class="badge b-green">✓ Водитель</span>`;
    }

    // Статус пассажира
    let paxBadge = '';
    if (u.blockedAsPassenger || isAdminBlocked)
      paxBadge = `<span class="badge b-red">🚫 Пасс.</span>`;
    else if (!isDriver)
      paxBadge = `<span class="badge b-green">✓ Пассажир</span>`;

    const statusHtml = [drvBadge, paxBadge].filter(Boolean).join(' ') ||
      `<span class="badge" style="background:var(--bg3);color:var(--text3)">—</span>`;

    return `
      <tr>
        <td>
          <div style="font-weight:700">${u.name || '—'}</div>
          <div style="font-size:11px;color:var(--text3)">${u.tgId || ''}</div>
        </td>
        <td>${u.phone || '—'}</td>
        <td>${u.city || '—'}</td>
        <td style="font-size:12px">
          ${u.car ? `${u.car.brand || ''} ${u.car.year || ''}<br><span style="color:var(--text3)">${u.car.num || ''} · ${u.car.color || ''}</span>` : '<span style="color:var(--text3)">—</span>'}
        </td>
        <td>⭐ ${fmtRating(u.rating)}</td>
        <td>${statusHtml}</td>
        <td><button class="btn-sm btn-view" onclick="openUserDetail('${id}')">Подробнее →</button></td>
      </tr>`;
  }).join('');
}

async function approveDriver(driverId) {
  if (!confirm('Одобрить водителя?')) return;
  await updateDoc('users', driverId, { approved: true });
  try {
    const key = 'tt_users_' + driverId;
    const raw = localStorage.getItem(key);
    if (raw) { const doc = JSON.parse(raw); doc.approved = true; localStorage.setItem(key, JSON.stringify(doc)); }
  } catch (e) {}
  showToast('Водитель одобрен ✅', 'ok');
  loadUsers();
}

async function sendForReview(driverId, name) {
  if (!confirm(`Отправить ${name} на повторную проверку?`)) return;
  await updateDoc('users', driverId, { approved: false });
  showToast('Водитель отправлен на проверку', 'ok');
  loadUsers();
}

async function blockDriverPermanent(id, name) {
  if (!confirm(`Заблокировать водителя ${name}? Блокировка постоянная до ручного разблока.`)) return;
  try {
    await updateDoc('users', id, {
      blockedAsDriver: true,
      tempBlocked: true, tempBlockedUntil: null, tempBlockReason: 'admin',
    });
    showToast(`Водитель ${name} заблокирован`, 'ok');
    loadUsers();
  } catch (e) { showToast('Ошибка: ' + e.message, 'err'); }
}

async function unblockDriverPermanent(id, name) {
  if (!confirm(`Разблокировать водителя ${name}?`)) return;
  try {
    await updateDoc('users', id, {
      blockedAsDriver: false, blocked: false, approved: true,
      tempBlocked: false, tempBlockedUntil: null, tempBlockReason: null,
    });
    showToast(`Водитель ${name} разблокирован ✅`, 'ok');
    loadUsers();
  } catch (e) { showToast('Ошибка: ' + e.message, 'err'); }
}

async function blockPassengerPermanent(id, name) {
  if (!confirm(`Заблокировать ${name} как пассажира? Блокировка постоянная.`)) return;
  try {
    await updateDoc('users', id, {
      blockedAsPassenger: true,
      tempBlocked: true, tempBlockedUntil: null, tempBlockReason: 'admin',
    });
    showToast(`${name} заблокирован как пассажир`, 'ok');
    loadUsers();
  } catch (e) { showToast('Ошибка: ' + e.message, 'err'); }
}

async function unblockPassengerPermanent(id, name) {
  if (!confirm(`Разблокировать ${name} как пассажира?`)) return;
  try {
    await updateDoc('users', id, {
      blockedAsPassenger: false, blocked: false,
      tempBlocked: false, tempBlockedUntil: null, tempBlockReason: null,
    });
    showToast(`${name} разблокирован как пассажир ✅`, 'ok');
    loadUsers();
  } catch (e) { showToast('Ошибка: ' + e.message, 'err'); }
}

async function extendFree(driverId) {
  const newFree = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  await updateDoc('users', driverId, { freeUntil: newFree, approved: true });
  showToast('Добавлено 30 бесплатных дней ✅', 'ok');
  loadUsers();
}

// ============================================================
// USER DETAIL MODAL
// ============================================================
async function openUserDetail(uid) {
  const user = allUsers.find(u => (u.id || u.tgId) === uid);
  if (!user) return;
  _currentUD = user;
  _udPeriod = 'today';

  document.getElementById('ud-name').textContent = user.name || '—';
  document.getElementById('ud-meta').textContent = [
    user.phone, user.city,
    user.tgId ? 'TG: ' + user.tgId : ''
  ].filter(Boolean).join(' · ');

  // Reset period tabs
  document.querySelectorAll('[id^="udp-"]').forEach(el => {
    if (!el.id.includes('range') && !el.id.includes('from') && !el.id.includes('to')) el.classList.remove('on');
  });
  document.getElementById('udp-today')?.classList.add('on');
  document.getElementById('udp-range-row').style.display = 'none';

  document.getElementById('mo-user').classList.add('open');
  document.getElementById('ud-stats').innerHTML = '<div style="color:var(--text3);font-size:13px;grid-column:1/-1;padding:8px 0">Загрузка статистики...</div>';

  if (!_allOrdersCache) _allOrdersCache = await getAllOrders();
  renderUDStats();
  renderUDActions(user);
}

function closeUserDetail() {
  document.getElementById('mo-user').classList.remove('open');
  _currentUD = null;
}

function setUDPeriod(p) {
  _udPeriod = p;
  document.querySelectorAll('[id^="udp-"]').forEach(el => {
    if (!el.id.includes('range') && !el.id.includes('from') && !el.id.includes('to')) el.classList.remove('on');
  });
  document.getElementById('udp-' + p)?.classList.add('on');
  document.getElementById('udp-range-row').style.display = p === 'range' ? 'flex' : 'none';
  renderUDStats();
}

function renderUDStats() {
  if (!_currentUD || !_allOrdersCache) return;
  const user  = _currentUD;
  const uid   = user.id || user.tgId;
  const from  = document.getElementById('udp-from')?.value;
  const to    = document.getElementById('udp-to')?.value;
  const range = getPeriodRange(_udPeriod, from, to);

  const inPeriod = _allOrdersCache.filter(o => {
    const d = new Date(o.createdAt); return d >= range.start && d < range.end;
  });

  // Как пассажир
  const paxTrips     = inPeriod.filter(o => o.passengerUid === uid && o.status === 'done').length;
  const paxCancelled = inPeriod.filter(o => o.passengerUid === uid && o.status === 'cancelled').length;

  // Как водитель
  const isDriver  = user.role === 'driver' || !!user.car;
  const drvOrders = inPeriod.filter(o => o.acceptedDriver?.uid === uid && o.status === 'done');
  const drvEarn   = drvOrders.reduce((s, o) => s + Number(o.acceptedPrice || o.price || 0), 0);

  const freeUntil = user.freeUntil ? new Date(user.freeUntil) : null;
  const subLabel  = freeUntil && freeUntil > new Date()
    ? `<span class="badge b-green">Бесплатно до ${fmtDateShort(user.freeUntil)}</span>`
    : (isDriver ? `<span class="badge b-orange">Нужна оплата</span>` : '');

  document.getElementById('ud-stats').innerHTML = `
    <div class="ud-stat">
      <div class="val">${paxTrips}</div>
      <div class="lbl">Поездок (пасс.)</div>
    </div>
    <div class="ud-stat">
      <div class="val" style="color:var(--red)">${paxCancelled}</div>
      <div class="lbl">Отмен (пасс.)</div>
    </div>
    ${isDriver ? `
    <div class="ud-stat">
      <div class="val">${drvOrders.length}</div>
      <div class="lbl">Заказов (вод.)</div>
    </div>
    <div class="ud-stat">
      <div class="val" style="font-size:20px">${fmtPrice(drvEarn)}₸</div>
      <div class="lbl">Заработано (вод.)</div>
    </div>` : ''}
  `;

  document.getElementById('ud-roles').innerHTML = `
    <div style="font-size:11px;font-weight:700;color:var(--text3);letter-spacing:.5px;margin-bottom:8px">РОЛИ И СТАТУС</div>
    <div style="display:flex;flex-direction:column;gap:6px;font-size:13px">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--card);border-radius:8px;border:1px solid var(--border)">
        <span>🧳 Пассажир</span>
        ${user.blockedAsPassenger ? '<span class="badge b-red">🚫 Заблокирован (адм.)</span>' : user.tempBlocked && !user.blockedAsDriver ? '<span class="badge b-orange">🔒 Авто-блок</span>' : '<span class="badge b-green">✓ Активен</span>'}
      </div>
      ${isDriver ? `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--card);border-radius:8px;border:1px solid var(--border)">
        <span>🚗 Водитель ${subLabel}</span>
        ${user.blocked || user.blockedAsDriver ? '<span class="badge b-red">🚫 Заблокирован (адм.)</span>' : user.tempBlocked ? '<span class="badge b-orange">🔒 Авто-блок</span>' : user.approved === false ? '<span class="badge b-yellow">⏳ На проверке</span>' : '<span class="badge b-green">✓ Активен</span>'}
      </div>` : ''}
    </div>
  `;
}

function renderUDActions(user) {
  if (!user) return;
  const uid      = user.id || user.tgId;
  const safeName = (user.name || '—').replace(/'/g, "\\'");
  const isDriver = user.role === 'driver' || !!user.car;
  const isAdminBlocked = user.tempBlocked && user.tempBlockReason === 'admin';
  const isDrvBlocked   = user.blocked || user.blockedAsDriver || isAdminBlocked;
  const isPaxBlocked   = user.blockedAsPassenger || isAdminBlocked;
  const isPending  = isDriver && user.approved === false && !isDrvBlocked;
  const isApproved = isDriver && user.approved === true && !isDrvBlocked;

  const btns = [];
  if (isDriver) {
    if (isPending)  btns.push(`<button class="btn-sm btn-approve" onclick="approveDriver('${uid}')">✓ Одобрить</button>`);
    if (isApproved) btns.push(`<button class="btn-sm btn-view" onclick="sendForReview('${uid}','${safeName}')">🔄 На проверку</button>`);
    if (!isDrvBlocked) btns.push(`<button class="btn-sm btn-reject" onclick="blockDriverPermanent('${uid}','${safeName}')">🚫 Блок водитель</button>`);
    if (isDrvBlocked)  btns.push(`<button class="btn-sm btn-approve" onclick="unblockDriverPermanent('${uid}','${safeName}')">✅ Разблок водитель</button>`);
    if (!isDrvBlocked) btns.push(`<button class="btn-sm btn-view" onclick="extendFree('${uid}')">+30 дней</button>`);
  }
  if (!isPaxBlocked) btns.push(`<button class="btn-sm btn-reject" onclick="blockPassengerPermanent('${uid}','${safeName}')">🚫 Блок пассажир</button>`);
  if (isPaxBlocked)  btns.push(`<button class="btn-sm btn-approve" onclick="unblockPassengerPermanent('${uid}','${safeName}')">✅ Разблок пассажир</button>`);

  document.getElementById('ud-actions').innerHTML = btns.join('') ||
    '<span style="color:var(--text3);font-size:12px">Нет доступных действий</span>';
}

// ============================================================
// ORDERS
// ============================================================
async function loadOrders() {
  document.getElementById('orders-tbody').innerHTML = '<tr><td colspan="9" class="empty">⏳ Загрузка...</td></tr>';
  allOrders = await getAllOrders();
  renderOrders();
}

function filterOrders(f) {
  orderFilter = f;
  document.querySelectorAll('[id^="of-"]').forEach(el => el.classList.remove('on'));
  const el = document.getElementById('of-' + f); if (el) el.classList.add('on');
  renderOrders();
}

function searchOrders(q) { _orderSearch = q.trim().toLowerCase(); renderOrders(); }

function renderOrders() {
  let list = allOrders.filter(o => o.type !== 'intercity');
  if (orderFilter !== 'all') list = list.filter(o => o.status === orderFilter);
  if (_orderSearch) {
    const q = _orderSearch;
    list = list.filter(o =>
      (o.passengerPhone || '').toLowerCase().includes(q) ||
      (o.passengerName  || '').toLowerCase().includes(q) ||
      (o.acceptedDriver?.name  || '').toLowerCase().includes(q) ||
      (o.acceptedDriver?.phone || '').toLowerCase().includes(q) ||
      (o.id || '').toLowerCase().includes(q)
    );
  }
  list = list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const tbody = document.getElementById('orders-tbody');
  if (!list.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty">Нет заказов</td></tr>'; return; }

  tbody.innerHTML = list.map(o => {
    const safeId = (o.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const drvCell = o.acceptedDriver
      ? `<div style="font-weight:700">${o.acceptedDriver.name || '—'}</div><div style="font-size:11px;color:var(--text3)">${o.acceptedDriver.phone || ''}</div>`
      : '<span style="color:var(--text3)">—</span>';
    return `
      <tr id="orow-${safeId}">
        <td>
          <div style="font-weight:700">${o.passengerName || '—'}</div>
          <div style="font-size:11px;color:var(--text3)">${o.passengerPhone || ''}</div>
        </td>
        <td style="max-width:160px;font-size:12px">
          <div>${o.from || '—'}</div>
          <div style="color:var(--text3)">→ ${o.to || '—'}</div>
        </td>
        <td>
          <div style="font-weight:700;color:var(--y)">${fmtPrice(o.acceptedPrice || o.price)}₸</div>
          <span class="badge ${o.payMethod === 'cash' ? 'b-blue' : 'b-green'}" style="font-size:10px">${o.payMethod === 'cash' ? '💵 Нал' : '📲 Перевод'}</span>
        </td>
        <td>${statusBadge(o.status)}</td>
        <td style="font-size:12px">${drvCell}</td>
        <td style="color:var(--text3);font-size:11px;white-space:nowrap">
          <div>${fmtDate(o.createdAt)}</div>
          <div style="color:var(--text2)">${fmtTime(o.createdAt)}</div>
        </td>
        <td><button class="btn-sm btn-view" onclick="toggleOrderDetails('${safeId}')" id="obtn-${safeId}">▼ Детали</button></td>
      </tr>
      <tr id="odetails-${safeId}" class="ord-detail-row" style="display:none">
        <td colspan="7"><div class="ord-detail-inner">${buildOrderDetails(o)}</div></td>
      </tr>`;
  }).join('');
}

function buildOrderDetails(o) {
  const parts = [`<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;margin-bottom:8px">`];
  parts.push(`<span><span style="color:var(--text3)">ID:</span> <span style="font-family:monospace;font-size:11px">${o.id || '—'}</span></span>`);
  if (o.paxCount)   parts.push(`<span><span style="color:var(--text3)">Пассажиров:</span> ${o.paxCount}</span>`);
  if (o.childSeat)  parts.push(`<span>🪑 Детское кресло</span>`);
  if (o.comment)    parts.push(`<span><span style="color:var(--text3)">Коммент:</span> ${o.comment}</span>`);
  if (o.city)       parts.push(`<span><span style="color:var(--text3)">Город:</span> ${o.city}</span>`);
  parts.push('</div>');

  // Итог для завершённых
  if (o.status === 'done' && o.acceptedDriver) {
    parts.push(`<div style="padding:8px 12px;background:rgba(34,197,94,.07);border-radius:8px;border:1px solid rgba(34,197,94,.2);font-size:12px;margin-bottom:8px">
      ✅ Завершён · Водитель: <strong>${o.acceptedDriver.name || '—'}</strong> ${o.acceptedDriver.phone ? '· ' + o.acceptedDriver.phone : ''} · Итог: <strong style="color:var(--y)">${fmtPrice(o.acceptedPrice || o.price)}₸</strong>
    </div>`);
  }

  // Отмена
  if (o.status === 'cancelled') {
    const who = o.cancelledBy === 'passenger' ? '🧳 Пассажир' : o.cancelledBy === 'driver' ? '🚗 Водитель' : '—';
    parts.push(`<div style="padding:8px 12px;background:rgba(239,68,68,.07);border-radius:8px;border:1px solid rgba(239,68,68,.2);font-size:12px;margin-bottom:8px">
      <strong style="color:var(--red)">Отмена</strong> · Отменил: ${who}
      ${o.cancelledAt ? ' · ' + fmtDate(o.cancelledAt) + ' ' + fmtTime(o.cancelledAt) : ''}
      ${o.cancelReason ? '<br>Причина: ' + o.cancelReason : ''}
      ${o.disputeId ? `<br>Диспут: <span style="font-family:monospace;color:var(--orange)">${o.disputeId}</span>` : ''}
    </div>`);
  }

  // Жалоба / диспут вне отмены
  if (o.disputeId && o.status !== 'cancelled') {
    parts.push(`<div style="padding:8px 12px;background:rgba(249,115,22,.07);border-radius:8px;border:1px solid rgba(249,115,22,.2);font-size:12px">
      ⚔️ Диспут: <span style="font-family:monospace;color:var(--orange)">${o.disputeId}</span>
      ${o.complaint ? '<br>' + o.complaint : ''}
    </div>`);
  }

  return parts.join('');
}

function toggleOrderDetails(safeId) {
  const row = document.getElementById('odetails-' + safeId);
  const btn = document.getElementById('obtn-' + safeId);
  if (!row) return;
  const open = row.style.display !== 'none';
  row.style.display = open ? 'none' : 'table-row';
  if (btn) btn.textContent = open ? '▼ Детали' : '▲ Скрыть';
}

// ============================================================
// INTERCITY
// ============================================================
async function loadIntercity() {
  const orders = await getAllOrders();
  const ic = orders.filter(o => o.type === 'intercity').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const tbody = document.getElementById('intercity-tbody');
  if (!ic.length) { tbody.innerHTML = '<tr><td colspan="8" class="empty">Нет межгородних заявок</td></tr>'; return; }
  tbody.innerHTML = ic.map(o => {
    const safeId = (o.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const contacts = o.contacts || [];
    const accepted = contacts.find(c => c.accepted) || (o.acceptedContact || null);
    return `
      <tr id="icrow-${safeId}">
        <td>
          <div style="font-weight:700">${o.passengerName || '—'}</div>
          <div style="font-size:11px;color:var(--text3)">${o.passengerPhone || ''}</div>
        </td>
        <td style="font-size:12px">
          <div>${o.from || '—'}</div>
          <div style="color:var(--text3)">→ ${o.to || '—'}</div>
        </td>
        <td style="white-space:nowrap;font-size:12px">
          <div>${o.date || '—'}</div>
          <div style="color:var(--text3)">${o.time || ''}</div>
        </td>
        <td style="font-size:12px">${o.icType || '—'}</td>
        <td style="color:var(--y);font-weight:700">${fmtPrice(o.price)}₸</td>
        <td>${statusBadge(o.status)}</td>
        <td style="font-size:12px">
          ${accepted
            ? `<div style="font-weight:700">${accepted.name || '—'}</div><div style="color:var(--text3);font-size:11px">${accepted.phone || ''}</div>`
            : contacts.length
              ? `<span style="color:var(--text3)">${contacts.length} обращ.</span>`
              : '<span style="color:var(--text3)">—</span>'}
        </td>
        <td><button class="btn-sm btn-view" onclick="toggleIcDetails('${safeId}')" id="icbtn-${safeId}">▼ Детали</button></td>
      </tr>
      <tr id="icdetails-${safeId}" class="ord-detail-row" style="display:none">
        <td colspan="8"><div class="ord-detail-inner">
          <div style="font-size:11px;font-family:monospace;color:var(--text3);margin-bottom:6px">ID: ${o.id || '—'}</div>
          ${o.comment ? `<div style="font-size:12px;margin-bottom:6px">Коммент: ${o.comment}</div>` : ''}
          ${contacts.length ? `<div style="font-size:12px"><span style="color:var(--text3)">Обратились водители:</span> ${contacts.map(c => `<strong>${c.name || '?'}</strong>${c.phone ? ' (' + c.phone + ')' : ''}`).join(', ')}</div>` : ''}
          ${o.cancelledBy ? `<div style="font-size:12px;color:var(--red);margin-top:6px">Отменил: ${o.cancelledBy === 'passenger' ? '🧳 Пассажир' : '🚗 Водитель'}</div>` : ''}
        </div></td>
      </tr>`;
  }).join('');
}

function toggleIcDetails(safeId) {
  const row = document.getElementById('icdetails-' + safeId);
  const btn = document.getElementById('icbtn-' + safeId);
  if (!row) return;
  const open = row.style.display !== 'none';
  row.style.display = open ? 'none' : 'table-row';
  if (btn) btn.textContent = open ? '▼ Детали' : '▲ Скрыть';
}

// ============================================================
// SUPPORT CHAT
// ============================================================
async function loadSupportChats() {
  if (!isFirebaseReady) { document.getElementById('support-chat-list').innerHTML = '<div class="empty">Firebase не подключён</div>'; return; }
  const msgs = await getAllFromFirebase('chats');
  const chats = {};
  msgs.forEach(m => {
    if (!chats[m.chatId]) chats[m.chatId] = { chatId: m.chatId, msgs: [], userName: m.userName, userId: m.userId, unread: 0 };
    chats[m.chatId].msgs.push(m);
    if (m.from === 'user') chats[m.chatId].unread++;
  });
  const list = document.getElementById('support-chat-list');
  const chatArr = Object.values(chats).sort((a, b) => {
    const la = a.msgs[a.msgs.length - 1]?.createdAt || '';
    const lb = b.msgs[b.msgs.length - 1]?.createdAt || '';
    return lb.localeCompare(la);
  });
  if (!chatArr.length) { list.innerHTML = '<div class="empty" style="padding:20px">Нет обращений</div>'; return; }
  let adminReadTs = {};
  try { adminReadTs = JSON.parse(sessionStorage.getItem('admin_read_ts') || '{}'); } catch(e) {}

  let totalUnread = 0;
  list.innerHTML = chatArr.map(c => {
    const sorted = [...c.msgs].sort((a, b) => a.createdAt > b.createdAt ? 1 : -1);
    const lastMsg = sorted[sorted.length - 1];
    const lastReadTs = adminReadTs[c.chatId] || '1970-01-01';
    const unread = sorted.filter(m => m.from === 'user' && m.createdAt > lastReadTs).length;
    totalUnread += unread;
    const safeId = c.chatId.replace(/[^a-z0-9_]/gi, '');
    return `
      <div class="chat-list-item" onclick="openAdminChat('${c.chatId}','${c.userName || ''}','${c.userId || ''}')" id="cli-${safeId}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div class="cli-name">${c.userName || 'Пользователь'}</div>
            <div style="font-size:10px;color:var(--text3)">ID: ${c.userId || '—'}</div>
          </div>
          ${unread ? `<span class="cli-unread">${unread}</span>` : ''}
        </div>
        <div class="cli-last">${lastMsg?.text?.substring(0, 40) || '—'}</div>
      </div>`;
  }).join('');
  const b = document.getElementById('nav-support-badge');
  if (totalUnread > 0) { b.textContent = totalUnread; b.style.display = 'inline'; } else b.style.display = 'none';
}

async function openAdminChat(chatId, userName, userId) {
  currentChatId = chatId;
  if (unsubChat) unsubChat();
  // Mark as read
  let adminReadTs = {};
  try { adminReadTs = JSON.parse(sessionStorage.getItem('admin_read_ts') || '{}'); } catch(e) {}
  adminReadTs[chatId] = new Date().toISOString();
  sessionStorage.setItem('admin_read_ts', JSON.stringify(adminReadTs));
  // Clear unread badge from list item
  const safeId = chatId.replace(/[^a-z0-9_]/gi, '');
  const cliEl = document.getElementById('cli-' + safeId);
  if (cliEl) { const badge = cliEl.querySelector('.cli-unread'); if (badge) badge.remove(); }
  // Recalculate and update nav badge
  _refreshAdminSupportBadge();
  document.getElementById('chat-input-area').style.display = 'flex';
  document.querySelectorAll('.chat-list-item').forEach(el => el.classList.remove('active'));
  const cli = document.getElementById('cli-' + safeId);
  if (cli) cli.classList.add('active');
  // Mobile: show full-screen chat with back button
  const chatLayout = document.querySelector('.chat-layout');
  if (chatLayout) chatLayout.classList.add('mob-chat-open');
  const mobHdr = document.getElementById('chat-area-mob-hdr');
  if (mobHdr) mobHdr.style.display = '';  // let CSS control it via media query
  const mobTitle = document.getElementById('chat-area-mob-title');
  if (mobTitle) mobTitle.textContent = userName || 'Чат';
  const msgsEl = document.getElementById('admin-chat-msgs');
  msgsEl.innerHTML = '<div class="empty">Загрузка...</div>';
  if (isFirebaseReady) {
    unsubChat = db.collection('chats').where('chatId', '==', chatId).onSnapshot(snap => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.createdAt > b.createdAt ? 1 : -1);
      msgsEl.innerHTML = msgs.map(m => `
        <div class="msg ${m.from === 'user' ? 'msg-user' : 'msg-admin'}">
          ${m.text}
          <div class="msg-time">${fmtTime(m.createdAt)}</div>
        </div>`).join('') || '<div class="empty">Нет сообщений</div>';
      msgsEl.scrollTop = msgsEl.scrollHeight;
    });
  }
}

async function adminSendMsg() {
  if (!currentChatId || !isFirebaseReady) return;
  const input = document.getElementById('admin-chat-input');
  const text = input.value.trim(); if (!text) return;
  input.value = '';
  const msgId = 'MSG-ADMIN-' + Date.now();
  await db.collection('chats').doc(msgId).set({ chatId: currentChatId, from: 'admin', text, createdAt: new Date().toISOString() });
}

function closeMobileChat() {
  const chatLayout = document.querySelector('.chat-layout');
  if (chatLayout) chatLayout.classList.remove('mob-chat-open');
  currentChatId = null;
  if (unsubChat) { unsubChat(); unsubChat = null; }
  document.getElementById('chat-input-area').style.display = 'none';
  document.getElementById('admin-chat-msgs').innerHTML = '<div style="text-align:center;color:var(--text3);padding:40px;font-size:13px">Выберите чат слева</div>';
  document.querySelectorAll('.chat-list-item').forEach(el => el.classList.remove('active'));
}

function _refreshAdminSupportBadge() {
  // Count remaining unread badges in the list
  let total = 0;
  document.querySelectorAll('.cli-unread').forEach(b => total += parseInt(b.textContent) || 0);
  const navBadge = document.getElementById('nav-support-badge');
  if (navBadge) {
    if (total > 0) { navBadge.textContent = total; navBadge.style.display = 'inline'; }
    else navBadge.style.display = 'none';
  }
}

// ============================================================
// SETTINGS
// ============================================================
async function loadSettings() {
  if (!isFirebaseReady) return;
  try {
    const snap = await db.collection('settings').doc('app').get();
    if (snap.exists) { appSettings = snap.data(); updateSettingsUI(); }
  } catch (e) {}
}

function updateSettingsUI() {
  const map = { bonusSystem: 'tog-bonus', intercity: 'tog-intercity', geoTracking: 'tog-geo', paidShifts: 'tog-paid' };
  Object.entries(map).forEach(([key, id]) => {
    const tog = document.getElementById(id); if (tog) tog.classList.toggle('on', appSettings[key] !== false);
  });
  if (appSettings.shiftPrice) document.getElementById('set-shift-price').value = appSettings.shiftPrice;
  if (appSettings.tonWallet) document.getElementById('set-ton-wallet').value = appSettings.tonWallet;
  if (appSettings.freeDays) document.getElementById('set-free-days').value = appSettings.freeDays;
  if (appSettings.passengerCancelPenalty !== undefined) document.getElementById('set-pax-penalty').value = appSettings.passengerCancelPenalty;
  if (appSettings.driverCancelPenalty   !== undefined) document.getElementById('set-drv-penalty').value = appSettings.driverCancelPenalty;
}

async function toggleSetting(key) {
  appSettings[key] = !(appSettings[key] !== false);
  updateSettingsUI();
  if (isFirebaseReady) { try { await db.collection('settings').doc('app').set(appSettings, { merge: true }); } catch (e) {} }
  showToast('Настройка сохранена ✅', 'ok');
}

async function saveShiftPrice() {
  const price = parseInt(document.getElementById('set-shift-price').value); if (!price) return;
  appSettings.shiftPrice = price;
  if (isFirebaseReady) { try { await db.collection('settings').doc('app').set({ shiftPrice: price }, { merge: true }); } catch (e) {} }
  showToast('Тариф сохранён ✅', 'ok');
}

async function saveTonWallet() {
  const wallet = document.getElementById('set-ton-wallet').value.trim(); if (!wallet) return;
  appSettings.tonWallet = wallet;
  if (isFirebaseReady) { try { await db.collection('settings').doc('app').set({ tonWallet: wallet }, { merge: true }); } catch (e) {} }
  showToast('TON кошелёк сохранён ✅', 'ok');
}

async function saveFreeDays() {
  const days = parseInt(document.getElementById('set-free-days').value); if (!days) return;
  appSettings.freeDays = days;
  if (isFirebaseReady) { try { await db.collection('settings').doc('app').set({ freeDays: days }, { merge: true }); } catch (e) {} }
  showToast('Сохранено ✅', 'ok');
}

async function savePenaltySettings() {
  const pax = parseFloat(document.getElementById('set-pax-penalty').value);
  const drv = parseFloat(document.getElementById('set-drv-penalty').value);
  if (isNaN(pax) || isNaN(drv)) { showToast('Введите корректные значения', 'err'); return; }
  appSettings.passengerCancelPenalty = pax;
  appSettings.driverCancelPenalty = drv;
  if (isFirebaseReady) {
    try { await db.collection('settings').doc('app').set({ passengerCancelPenalty: pax, driverCancelPenalty: drv }, { merge: true }); } catch (e) {}
  }
  showToast('Штрафные коэффициенты сохранены ✅', 'ok');
}

function copyRules() {
  const text = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /orders/{orderId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /driver_shifts/{shiftId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /ratings/{ratingId} {
      allow read, write: if request.auth != null;
    }
    match /chats/{msgId} {
      allow read, write: if request.auth != null;
    }
    match /settings/{doc} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /{document=**} {
      allow read, write: if request.auth != null && request.auth.token.admin == true;
    }
  }
}`;
  navigator.clipboard.writeText(text).then(() => showToast('Скопировано! ✅', 'ok')).catch(() => showToast('Скопируйте вручную', 'err'));
}

// ============================================================
// DISPUTES
// ============================================================

let _allDisputes = [];
let _disputeFilter = 'pending';

async function loadDisputes() {
  const list = document.getElementById('disputes-list');
  if (list) list.innerHTML = '<div class="empty-state" style="padding:32px;text-align:center;color:var(--text3)">Загрузка...</div>';
  try {
    _allDisputes = await getAllFromFirebase('disputes');
    _allDisputes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    renderDisputes();
    // Update badge
    const pending = _allDisputes.filter(d => d.status === 'pending').length;
    const badge = document.getElementById('nav-disputes-badge');
    if (badge) { badge.textContent = pending; badge.style.display = pending > 0 ? '' : 'none'; }
  } catch (e) {
    if (list) list.innerHTML = '<div class="empty-state" style="padding:32px;text-align:center;color:var(--text3)">Ошибка загрузки</div>';
  }
}

function filterDisputes(filter) { _disputeFilter = filter; renderDisputes(); }
function searchDisputes(q) { _disputeSearch = q.trim().toLowerCase(); renderDisputes(); }

function renderDisputes() {
  const list = document.getElementById('disputes-list');
  if (!list) return;
  let disputes = _allDisputes;
  if (_disputeFilter === 'pending')  disputes = disputes.filter(d => d.status === 'pending');
  else if (_disputeFilter === 'resolved') disputes = disputes.filter(d => d.status !== 'pending');
  if (_disputeSearch) {
    const q = _disputeSearch;
    disputes = disputes.filter(d =>
      (d.id             || '').toLowerCase().includes(q) ||
      (d.passengerPhone || '').toLowerCase().includes(q) ||
      (d.driverPhone    || '').toLowerCase().includes(q) ||
      (d.passengerName  || '').toLowerCase().includes(q) ||
      (d.driverName     || '').toLowerCase().includes(q)
    );
  }

  if (!disputes.length) {
    list.innerHTML = '<div class="empty-state" style="padding:32px;text-align:center;color:var(--text3)">Нет диспутов</div>';
    return;
  }

  const typeLabel = { driver_late: '🚗 Водитель опоздал', no_passenger: '❓ Пассажира нет' };
  list.innerHTML = disputes.map(d => {
    const isPending = d.status === 'pending';
    const typeStr   = typeLabel[d.type] || d.type;

    // Безопасное форматирование гео
    const fmtGeo = geo => {
      if (!geo) return '<span style="color:var(--text3);font-style:italic">не получена</span>';
      const lat = Number(geo.lat), lng = Number(geo.lng);
      if (isNaN(lat) || isNaN(lng)) return '<span style="color:var(--text3);font-style:italic">некорректные данные</span>';
      return `${lat.toFixed(5)}, ${lng.toFixed(5)} <a href="https://maps.google.com/?q=${lat},${lng}" target="_blank" style="font-size:10px;color:var(--primary)">карта ↗</a>`;
    };

    return `
    <div class="table-wrap" style="margin-bottom:16px">
      <div class="table-hdr" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
        <div>
          <strong>${d.id}</strong>
          <span style="margin-left:8px;font-size:12px;color:var(--text3)">${typeStr}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${isPending ? '<span class="badge b-yellow">⏳ Ожидает</span>' : '<span class="badge b-green">✓ Решён</span>'}
          <span style="font-size:11px;color:var(--text3)">${fmtDate(d.createdAt)}</span>
        </div>
      </div>
      <div style="padding:16px;display:flex;flex-direction:column;gap:10px">

        <!-- Участники -->
        <div style="display:flex;gap:16px;flex-wrap:wrap">
          <div style="flex:1;min-width:180px;background:var(--bg3);border-radius:8px;padding:10px">
            <div style="font-size:10px;font-weight:800;color:var(--text3);margin-bottom:6px;letter-spacing:.5px">ПАССАЖИР</div>
            <div style="font-weight:700">${d.passengerName || '—'}</div>
            <div style="font-size:12px;color:var(--text2);margin-top:2px">${d.passengerPhone || '—'}</div>
            <div style="font-size:11px;color:var(--text3);margin-top:5px">
              ✅ побед: ${d.passengerDisputesWon || 0} &nbsp; ❌ поражений: ${d.passengerDisputesLost || 0}
            </div>
          </div>
          <div style="flex:1;min-width:180px;background:var(--bg3);border-radius:8px;padding:10px">
            <div style="font-size:10px;font-weight:800;color:var(--text3);margin-bottom:6px;letter-spacing:.5px">ВОДИТЕЛЬ</div>
            <div style="font-weight:700">${d.driverName || '—'}</div>
            <div style="font-size:12px;color:var(--text2);margin-top:2px">${d.driverPhone || '—'}</div>
            <div style="font-size:11px;color:var(--text3);margin-top:5px">
              ✅ побед: ${d.driverDisputesWon || 0} &nbsp; ❌ поражений: ${d.driverDisputesLost || 0}
            </div>
          </div>
        </div>

        <!-- Маршрут -->
        <div style="font-size:13px;color:var(--text2)">📍 ${d.from || '—'} → ${d.to || '—'}</div>

        <!-- Геолокация -->
        <div style="display:flex;flex-direction:column;gap:4px;padding:10px;background:var(--bg3);border-radius:8px">
          <div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:2px">ГЕОЛОКАЦИЯ</div>
          <div style="font-size:12px">🚗 Водитель: ${fmtGeo(d.driverGeo)}</div>
          <div style="font-size:12px">🧳 Пассажир: ${fmtGeo(d.passengerGeo)}</div>
        </div>

        ${d.resolution ? `<div style="font-size:13px;color:var(--text2)">Решение: <strong>${_resolutionLabel(d.resolution)}</strong></div>` : ''}

        <!-- Кнопки решения -->
        ${isPending ? `
        <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
          <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px">Решение администратора:</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn-sm btn-danger" onclick="resolveDispute('${d.id}','passenger_guilty')">👎 Виноват пассажир</button>
            <button class="btn-sm btn-danger" onclick="resolveDispute('${d.id}','driver_guilty')">👎 Виноват водитель</button>
            <button class="btn-sm btn-view"   onclick="resolveDispute('${d.id}','both_guilty')">⚠️ Оба виноваты</button>
            <button class="btn-sm btn-view"   onclick="resolveDispute('${d.id}','draw')">🤝 Ничья</button>
          </div>
        </div>` : ''}

        <!-- Блок / Разблок из диспута -->
        <div style="border-top:1px solid var(--border);padding-top:10px;margin-top:4px">
          <div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:6px">УПРАВЛЕНИЕ ДОСТУПОМ</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${d.passengerId ? `
              <button class="btn-sm btn-reject"  onclick="adminBlockUser('${d.passengerId}','${(d.passengerName||'пассажир').replace(/'/g,"\\'")}')">🚫 Блок пасс.</button>
              <button class="btn-sm btn-approve" onclick="adminUnblockUser('${d.passengerId}','${(d.passengerName||'пассажир').replace(/'/g,"\\'")}')">✅ Разблок пасс.</button>
            ` : ''}
            ${d.driverUid ? `
              <button class="btn-sm btn-reject"  onclick="adminBlockUser('${d.driverUid}','${(d.driverName||'водитель').replace(/'/g,"\\'")}')">🚫 Блок вод.</button>
              <button class="btn-sm btn-approve" onclick="adminUnblockUser('${d.driverUid}','${(d.driverName||'водитель').replace(/'/g,"\\'")}')">✅ Разблок вод.</button>
            ` : ''}
          </div>
        </div>

      </div>
    </div>`;
  }).join('');
}

function _resolutionLabel(r) {
  const map = { passenger_guilty: '👎 Виноват пассажир', driver_guilty: '👎 Виноват водитель', both_guilty: '⚠️ Оба виноваты', draw: '🤝 Ничья' };
  return map[r] || r;
}

async function resolveDispute(disputeId, resolution) {
  if (!isFirebaseReady) { showToast('Firebase не подключён', 'err'); return; }
  try {
    const dispute = _allDisputes.find(d => d.id === disputeId);
    if (!dispute) { showToast('Диспут не найден', 'err'); return; }

    const paxPenalty = appSettings.passengerCancelPenalty || 0.1;
    const drvPenalty = appSettings.driverCancelPenalty    || 0.05;
    const now = new Date().toISOString();

    const paxGuilty = (resolution === 'passenger_guilty' || resolution === 'both_guilty');
    const drvGuilty = (resolution === 'driver_guilty'    || resolution === 'both_guilty');

    // Применить штрафы / засчитать победы
    if (paxGuilty) await _adminApplyPenalty(dispute.passengerId, paxPenalty, 'lost');
    else           await _adminApplyPenalty(dispute.passengerId, 0,          'won');
    if (drvGuilty) await _adminApplyPenalty(dispute.driverUid,  drvPenalty,  'lost');
    else           await _adminApplyPenalty(dispute.driverUid,  0,           'won');

    // Пометить диспут решённым
    await db.collection('disputes').doc(disputeId).set({
      status: 'resolved', resolution, resolvedAt: now,
    }, { merge: true });

    // Обновить локальный список до проверок блокировок
    const idx = _allDisputes.findIndex(d => d.id === disputeId);
    if (idx !== -1) _allDisputes[idx] = { ..._allDisputes[idx], status: 'resolved', resolution, resolvedAt: now };

    // Проверить блокировку для обоих участников:
    // 1) Если pending-диспутов стало < 3 — снять pending-блок
    // 2) Если проиграл >= 3 сегодня — поставить 24ч блок
    await _adminCheckBlockAfterResolve(dispute.passengerId, paxGuilty);
    await _adminCheckBlockAfterResolve(dispute.driverUid,   drvGuilty);

    // Уведомить пассажира
    await _adminSendNotification(dispute.passengerId, {
      type:    'dispute_result',
      message: paxGuilty
        ? '⚠️ Диспут решён не в вашу пользу: рейтинг снижен.'
        : resolution === 'draw'
        ? '🤝 Диспут завершён ничьей. Штрафов нет.'
        : '✅ Диспут решён в вашу пользу.',
      msgType: paxGuilty ? 'warn' : 'ok',
    });

    // Уведомить водителя
    await _adminSendNotification(dispute.driverUid, {
      type:    'dispute_result',
      message: drvGuilty
        ? '⚠️ Диспут решён не в вашу пользу: рейтинг снижен.'
        : resolution === 'draw'
        ? '🤝 Диспут завершён ничьей. Штрафов нет.'
        : '✅ Диспут решён в вашу пользу.',
      msgType: drvGuilty ? 'warn' : 'ok',
    });

    renderDisputes();
    showToast('Диспут решён ✅', 'ok');
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'err');
  }
}

/**
 * После решения диспута проверить и обновить блокировку пользователя.
 * Снимает pending-блок если осталось < 3 открытых диспутов.
 * Ставит 24ч блок если за сегодня >= 3 проигранных диспутов.
 */
async function _adminCheckBlockAfterResolve(uid, wasGuilty) {
  if (!uid) return;
  try {
    const snap = await db.collection('users').doc(uid).get();
    const user = snap.exists ? snap.data() : {};

    // Подсчитать оставшиеся pending-диспуты
    const pendingSnap = await db.collection('disputes')
      .where('status', '==', 'pending').get();
    const pendingCount = pendingSnap.docs.filter(d => {
      const data = d.data();
      return data.passengerId === uid || data.driverUid === uid;
    }).length;

    let update = {};

    // Снять pending-блок если диспутов < 3
    if (user.tempBlocked && user.tempBlockReason === 'pending_disputes' && pendingCount < 3) {
      update.tempBlocked      = false;
      update.tempBlockedUntil = null;
      update.tempBlockReason  = null;
    }

    // Если виноват — проверить счётчик проигрышей за сегодня
    if (wasGuilty) {
      const today = new Date().toDateString();
      const same  = user.lastDisputeLostDate === today;
      const lostToday = (same ? (user.disputesLostToday || 0) : 0) + 1;
      update.disputesLostToday  = lostToday;
      update.lastDisputeLostDate = today;

      if (lostToday >= 3) {
        const until = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        update.tempBlocked      = true;
        update.tempBlockedUntil = until;
        update.tempBlockReason  = 'lost_disputes_today';
        update.tempBlockCount   = (user.tempBlockCount || 0) + 1;
        showToast(`Пользователь ${user.name || uid} заблокирован на 24ч (3 проигранных диспута)`, 'warn');
      }
    }

    if (Object.keys(update).length) {
      await db.collection('users').doc(uid).set(update, { merge: true });
    }
  } catch (e) { console.warn('[adminCheckBlock]', e); }
}

async function _adminApplyPenalty(uid, amount, outcome) {
  if (!uid) return;
  try {
    const snap = await db.collection('users').doc(uid).get();
    const user = snap.exists ? snap.data() : {};
    const update = {};
    if (amount > 0) {
      update.rating = Math.max(1.0, Math.round(((user.rating || 5.0) - amount) * 100) / 100);
    }
    if (outcome === 'lost') update.disputesLost = (user.disputesLost || 0) + 1;
    else                    update.disputesWon  = (user.disputesWon  || 0) + 1;
    await db.collection('users').doc(uid).set(update, { merge: true });
  } catch (e) { console.warn('[adminPenalty]', e); }
}

/** Заблокировать пользователя (постоянно) из карточки диспута */
async function adminBlockUser(uid, name) {
  if (!confirm(`Заблокировать ${name}? Блокировка постоянная, до ручного разблока.`)) return;
  try {
    await db.collection('users').doc(uid).set({
      blocked: true, blockedAsPassenger: true,
      tempBlocked: true, tempBlockedUntil: null, tempBlockReason: 'admin',
    }, { merge: true });
    showToast(`${name} заблокирован`, 'ok');
    loadDisputes();
  } catch (e) { showToast('Ошибка: ' + e.message, 'err'); }
}

/** Разблокировать пользователя (снять блок) из карточки диспута */
async function adminUnblockUser(uid, name) {
  if (!confirm(`Разблокировать ${name}?`)) return;
  try {
    await db.collection('users').doc(uid).set({
      blocked: false, blockedAsPassenger: false, blockedAsDriver: false,
      tempBlocked: false, tempBlockedUntil: null, tempBlockReason: null,
    }, { merge: true });
    await _adminSendNotification(uid, {
      type: 'dispute_result',
      message: '✅ Ваша блокировка снята администратором. Добро пожаловать обратно!',
      msgType: 'ok',
    });
    showToast(`${name} разблокирован ✅`, 'ok');
    loadDisputes();
  } catch (e) { showToast('Ошибка: ' + e.message, 'err'); }
}

async function _adminSendNotification(uid, data) {
  if (!uid) return;
  try {
    await db.collection('notifications').doc(uid + '_pending').set({
      ...data,
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30000).toISOString(), // 30s for admin-sent notifications
    }, { merge: false });
  } catch (e) { console.warn('[adminNotif]', e); }
}

// ============================================================
// UTILS
// ============================================================
function fmtPrice(n) { return n ? Number(n).toLocaleString('ru') : '0'; }
function fmtRating(r) { return r ? Number(r).toFixed(1) : '—'; }
function fmtDate(iso) { if (!iso) return '—'; return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
function fmtDateShort(iso) { if (!iso) return '—'; return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }); }
function fmtTime(iso) { if (!iso) return ''; return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
function statusBadge(s) {
  const map = { searching: ['b-yellow', '🔍 Поиск'], active: ['b-blue', '🟢 Активен'], arrived: ['b-blue', '🚗 Прибыл'], riding: ['b-green', '🛣️ В пути'], done: ['b-green', '✓ Завершён'], cancelled: ['b-red', '✗ Отменён'] };
  const [cls, label] = map[s] || ['', '' + s];
  return `<span class="badge ${cls}">${label}</span>`;
}
let toastTimer;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show' + (type ? ' ' + type : '');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// Auto-refresh every 60s
setInterval(() => {
  const active = document.querySelector('.page.active');
  if (!active) return;
  if (active.id === 'page-dashboard') loadDashboard();
  else if (active.id === 'page-users') loadUsers();
}, 60000);

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

// ============================================================
// ВАЖНО: СМЕНИТЕ ПАРОЛИ ПЕРЕД ДЕПЛОЕМ!
// ============================================================
const ADMIN_CREDENTIALS = {
  'admin': 'taxiadmin2024',   // Смените!
  'support': 'support2024'    // Смените!
};

let db = null, isFirebaseReady = false;
let currentChatId = null, unsubChat = null;
let allDrivers = [], allOrders = [], appSettings = {};
let driverFilter = 'all', orderFilter = 'all';

// ============================================================
// INIT
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  const authed = sessionStorage.getItem('taxi_admin_auth');
  if (authed === 'true') showAdmin();
  initFirebase();
});

function initFirebase() {
  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    isFirebaseReady = true;
    firebase.auth && firebase.auth().signInAnonymously().catch(e => console.warn('auth:', e.message));
    console.log('Firebase: OK');
  } catch (e) { console.error('Firebase error:', e); }
}

// ============================================================
// AUTH
// ============================================================
function doLogin() {
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;
  if (ADMIN_CREDENTIALS[user] && ADMIN_CREDENTIALS[user] === pass) {
    sessionStorage.setItem('taxi_admin_auth', 'true');
    sessionStorage.setItem('taxi_admin_user', user);
    showAdmin();
  } else {
    showToast('Неверный логин или пароль', 'err');
    document.getElementById('login-pass').value = '';
  }
}

function logout() {
  sessionStorage.clear();
  document.getElementById('admin-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

function showAdmin() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('admin-screen').style.display = 'block';
  loadDashboard();
  loadSettings();
}

// ============================================================
// NAVIGATION
// ============================================================
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pg = document.getElementById('page-' + page);
  const nav = document.getElementById('nav-' + page);
  if (pg) pg.classList.add('active');
  if (nav) nav.classList.add('active');
  if (page === 'dashboard') loadDashboard();
  else if (page === 'drivers') loadDrivers();
  else if (page === 'passengers') loadPassengers();
  else if (page === 'orders') loadOrders();
  else if (page === 'intercity') loadIntercity();
  else if (page === 'support') loadSupportChats();
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
async function loadDashboard() {
  document.getElementById('dash-updated').textContent = 'Загрузка...';
  const users = await getAllUsers();
  const orders = await getAllOrders();
  const shifts = await getAllFromFirebase('driver_shifts');

  const drivers = users.filter(u => u.role === 'driver');
  const pending = drivers.filter(d => d.approved === false && !d.blocked);
  const today = new Date().toDateString();
  const ordersToday = orders.filter(o => new Date(o.createdAt).toDateString() === today);
  const now = new Date();
  const onlineShifts = shifts.filter(s => s.active && new Date(s.until) > now);

  document.getElementById('st-users').textContent = users.length;
  document.getElementById('st-drivers').textContent = drivers.length;
  document.getElementById('st-online').textContent = onlineShifts.length;
  document.getElementById('st-orders-today').textContent = ordersToday.length;
  document.getElementById('st-orders-total').textContent = orders.length;
  document.getElementById('st-pending').textContent = pending.length;
  document.getElementById('dash-updated').textContent = 'Обновлено: ' + new Date().toLocaleTimeString('ru-RU');

  const pendingSection = document.getElementById('dash-pending-section');
  if (pendingSection) pendingSection.style.display = pending.length > 0 ? 'block' : 'none';

  if (pending.length > 0) {
    const badge = document.getElementById('nav-pending-badge');
    badge.textContent = pending.length; badge.style.display = 'inline';
  }

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
// DRIVERS
// ============================================================
async function loadDrivers() {
  document.getElementById('drivers-tbody').innerHTML = '<tr><td colspan="9" class="empty">⏳ Загрузка...</td></tr>';
  const users = await getAllUsers();
  allDrivers = users.filter(u => u.role === 'driver' || u.appliedForDriverAt);
  renderDrivers();
  const pending = allDrivers.filter(d => d.approved === false && !d.blocked);
  const badge = document.getElementById('nav-pending-badge');
  if (pending.length) { badge.textContent = pending.length; badge.style.display = 'inline'; }
  else badge.style.display = 'none';
}

function filterDrivers(f) {
  driverFilter = f;
  document.querySelectorAll('[id^="df-"]').forEach(el => el.classList.remove('on'));
  const el = document.getElementById('df-' + f); if (el) el.classList.add('on');
  renderDrivers();
}

function renderDrivers() {
  let list = allDrivers;
  if (driverFilter === 'pending') list = list.filter(d => d.approved === false && !d.blocked);
  else if (driverFilter === 'approved') list = list.filter(d => d.approved === true && !d.blocked);
  else if (driverFilter === 'blocked') list = list.filter(d => d.blocked === true);
  list = list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const tbody = document.getElementById('drivers-tbody');
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty">Нет водителей${driverFilter !== 'all' ? ' в этой категории' : ''}</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(d => {
    const freeUntil = d.freeUntil ? new Date(d.freeUntil) : null;
    const isFree = freeUntil && freeUntil > new Date();
    const subBadge = isFree
      ? `<span class="badge b-green">Бесплатно до ${fmtDateShort(d.freeUntil)}</span>`
      : '<span class="badge b-orange">Нужна оплата</span>';
    const statusBadgeHtml = d.blocked
      ? '<span class="badge b-red">Заблокирован</span>'
      : d.approved
        ? '<span class="badge b-green">Активен</span>'
        : '<span class="badge b-orange">На проверке ⏳</span>';
    return `
      <tr>
        <td><div style="font-weight:700">${d.name || '—'}</div><div style="font-size:11px;color:var(--text3)">${d.tgId}</div></td>
        <td>${d.phone || '—'}</td>
        <td>${d.city || '—'}</td>
        <td>${d.car ? `${d.car.brand} ${d.car.year}<br><span style="color:var(--text3);font-size:11px">${d.car.num} · ${d.car.color}</span>` : '<span style="color:var(--text3)">—</span>'}</td>
        <td>⭐ ${fmtRating(d.rating)}</td>
        <td>${d.trips || 0}</td>
        <td>${statusBadgeHtml}</td>
        <td>${subBadge}</td>
        <td style="white-space:nowrap">
          <div style="display:flex;gap:4px;flex-wrap:wrap">
            ${!d.approved && !d.blocked ? `<button class="btn-sm btn-approve" onclick="approveDriver('${d.id || d.tgId}')">✓ Одобрить</button>` : ''}
            ${d.approved && !d.blocked ? `<button class="btn-sm btn-reject" onclick="blockDriver('${d.id || d.tgId}')">✗ Блок</button>` : ''}
            ${d.blocked ? `<button class="btn-sm btn-approve" onclick="unblockDriver('${d.id || d.tgId}')">↩ Разблок</button>` : ''}
            <button class="btn-sm btn-view" onclick="extendFree('${d.id || d.tgId}')">+30д</button>
          </div>
        </td>
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
  loadDrivers();
}

async function blockDriver(driverId) {
  if (!confirm('Заблокировать водителя?')) return;
  await updateDoc('users', driverId, { blocked: true, approved: false });
  showToast('Водитель заблокирован', 'ok');
  loadDrivers();
}

async function unblockDriver(driverId) {
  await updateDoc('users', driverId, { blocked: false, approved: true });
  showToast('Водитель разблокирован ✅', 'ok');
  loadDrivers();
}

async function extendFree(driverId) {
  const newFree = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  await updateDoc('users', driverId, { freeUntil: newFree, approved: true });
  showToast('Добавлено 30 бесплатных дней ✅', 'ok');
  loadDrivers();
}

// ============================================================
// PASSENGERS
// ============================================================
async function loadPassengers() {
  document.getElementById('passengers-tbody').innerHTML = '<tr><td colspan="7" class="empty">⏳ Загрузка...</td></tr>';
  const users = await getAllUsers();
  const passengers = users.filter(u => u.role === 'passenger' || (!u.role && !u.car));
  const tbody = document.getElementById('passengers-tbody');
  if (!passengers.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty">Нет пассажиров</td></tr>'; return; }
  tbody.innerHTML = passengers.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).map(p => `
    <tr>
      <td><div style="font-weight:700">${p.name || '—'}</div><div style="font-size:11px;color:var(--text3)">${p.tgId}</div></td>
      <td>${p.phone || '—'}</td>
      <td>${p.city || '—'}</td>
      <td>⭐ ${fmtRating(p.rating)}</td>
      <td>${p.trips || 0}</td>
      <td style="font-size:11px;color:var(--text3)">${fmtDate(p.createdAt)}</td>
      <td>
        ${!p.blocked
          ? `<button class="btn-sm btn-reject" onclick="blockUser('${p.id || p.tgId}')">Блок</button>`
          : `<button class="btn-sm btn-approve" onclick="unblockUser('${p.id || p.tgId}')">Разблок</button>`}
      </td>
    </tr>`).join('');
}

async function blockUser(id) {
  if (!confirm('Заблокировать пользователя?')) return;
  await updateDoc('users', id, { blocked: true }); showToast('Заблокирован', 'ok'); loadPassengers();
}
async function unblockUser(id) {
  await updateDoc('users', id, { blocked: false }); showToast('Разблокирован ✅', 'ok'); loadPassengers();
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

function renderOrders() {
  let list = allOrders.filter(o => o.type !== 'intercity');
  if (orderFilter !== 'all') list = list.filter(o => o.status === orderFilter);
  list = list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const tbody = document.getElementById('orders-tbody');
  if (!list.length) { tbody.innerHTML = '<tr><td colspan="9" class="empty">Нет заказов</td></tr>'; return; }
  tbody.innerHTML = list.map(o => `
    <tr>
      <td style="font-size:10px;color:var(--text3)">${(o.id || '—').substring(0, 12)}...</td>
      <td><div style="font-weight:700">${o.passengerName || '—'}</div><div style="font-size:11px;color:var(--text3)">${o.passengerPhone || ''}</div></td>
      <td style="font-size:12px;max-width:120px">${o.from || '—'}</td>
      <td style="font-size:12px;max-width:120px">${o.to || '—'}</td>
      <td style="font-weight:700;color:var(--y)">${fmtPrice(o.acceptedPrice || o.price)}₸</td>
      <td><span class="badge ${o.payMethod === 'cash' ? 'b-blue' : 'b-green'}">${o.payMethod === 'cash' ? '💵 Нал' : '📲 Перевод'}</span></td>
      <td>${statusBadge(o.status)}</td>
      <td style="font-size:12px">${o.acceptedDriver ? o.acceptedDriver.name : '—'}</td>
      <td style="color:var(--text3);font-size:11px">${fmtDate(o.createdAt)}</td>
    </tr>`).join('');
}

// ============================================================
// INTERCITY
// ============================================================
async function loadIntercity() {
  const orders = await getAllOrders();
  const ic = orders.filter(o => o.type === 'intercity').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const tbody = document.getElementById('intercity-tbody');
  if (!ic.length) { tbody.innerHTML = '<tr><td colspan="8" class="empty">Нет межгородних заявок</td></tr>'; return; }
  tbody.innerHTML = ic.map(o => `
    <tr>
      <td style="font-size:10px;color:var(--text3)">${(o.id || '—').substring(0, 10)}...</td>
      <td><div style="font-weight:700">${o.passengerName || '—'}</div><div style="font-size:11px;color:var(--text3)">${o.passengerPhone || ''}</div></td>
      <td style="font-size:12px"><div>${o.from || '—'}</div><div style="color:var(--text3)">→ ${o.to || '—'}</div></td>
      <td>${o.date || '—'} ${o.time || '—'}</td>
      <td>${o.icType || '—'}</td>
      <td style="color:var(--y);font-weight:700">${fmtPrice(o.price)}₸</td>
      <td>${statusBadge(o.status)}</td>
      <td>${(o.contacts || []).length}</td>
    </tr>`).join('');
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
  list.innerHTML = chatArr.map(c => {
    const lastMsg = c.msgs.sort((a, b) => a.createdAt > b.createdAt ? 1 : -1).pop();
    const safeId = c.chatId.replace(/[^a-z0-9_]/gi, '');
    return `
      <div class="chat-list-item" onclick="openAdminChat('${c.chatId}','${c.userName}')" id="cli-${safeId}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div class="cli-name">${c.userName || 'Пользователь'}</div>
          ${c.unread ? `<span class="cli-unread">${c.unread}</span>` : ''}
        </div>
        <div class="cli-last">${lastMsg?.text?.substring(0, 40) || '—'}</div>
      </div>`;
  }).join('');
  const totalUnread = chatArr.reduce((s, c) => s + c.unread, 0);
  const b = document.getElementById('nav-support-badge');
  if (totalUnread > 0) { b.textContent = totalUnread; b.style.display = 'inline'; } else b.style.display = 'none';
}

async function openAdminChat(chatId, userName) {
  currentChatId = chatId;
  if (unsubChat) unsubChat();
  document.getElementById('chat-input-area').style.display = 'flex';
  document.querySelectorAll('.chat-list-item').forEach(el => el.classList.remove('active'));
  const cli = document.getElementById('cli-' + chatId.replace(/[^a-z0-9_]/gi, ''));
  if (cli) cli.classList.add('active');
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

// Auto-refresh dashboard every 60s
setInterval(() => {
  const active = document.querySelector('.page.active');
  if (active && active.id === 'page-dashboard') loadDashboard();
}, 60000);

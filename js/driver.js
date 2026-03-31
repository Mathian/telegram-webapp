/* ============================================================
   DRIVER — Orders, shift management, active ride
   Fixes:
     - startListeningOrders / stopListeningOrders don't conflict
     - Passenger trip count incremented on finishRide
     - Shift auto-end timeout uses proper JS timer
     - Driver history uses correct query
   ============================================================ */

let _unsubDriverOrders = null;
let _shiftTimer = null;
const _pendingOfferListeners = {}; // orderId -> unsubFn

// ---- Init ----
function setupDriverListeners() {
  updateDriverUI();
  if (STATE.shiftActive && !STATE.driverActiveOrderId) {
    startListeningOrders();
  }
  if (STATE.driverActiveOrderId) {
    startListeningActiveOrder();
  }
  // Re-validate shift expiry
  if (STATE.shiftActive && STATE.shiftUntil) {
    const remaining = new Date(STATE.shiftUntil) - Date.now();
    if (remaining <= 0) {
      endShift();
    } else {
      clearTimeout(_shiftTimer);
      _shiftTimer = setTimeout(() => autoEndShift(), remaining);
    }
  }
  // Listen for approval status changes in real-time
  if (STATE.user && STATE.user.tgId) {
    onDocSnapshot('users', STATE.user.tgId, freshUser => {
      if (!freshUser) return;
      const wasApproved = STATE.user.approved;
      STATE.user = { ...STATE.user, ...freshUser };
      saveState();
      updateDriverUI();
      // Notify driver when approved
      if (!wasApproved && freshUser.approved === true) {
        showToast('Ваш аккаунт одобрен! Можно выходить на линию 🟢', 'ok');
        tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success');
      }
      // Notify if blocked
      if (!wasApproved !== true && freshUser.blocked === true) {
        showToast('Ваш аккаунт заблокирован', 'err');
      }
    });
  }
}

// ---- Listen for available orders ----
function startListeningOrders() {
  if (_unsubDriverOrders) return; // Already listening
  _unsubDriverOrders = onSnapshotQuery('orders', 'status', '==', 'searching', orders => {
    // Filter by city and driver mode
    const mode = (STATE.user && STATE.user.driverMode) || STATE.driverMode || 'city';
    const city = STATE.user ? STATE.user.city : '';
    const filtered = orders.filter(o => {
      if (o.city !== city) return false;
      if (mode === 'intercity') return o.type === 'intercity';
      return o.type !== 'intercity';
    });
    renderDriverOrders(filtered, mode);
  });
}

function stopListeningOrders() {
  if (_unsubDriverOrders) {
    _unsubDriverOrders();
    _unsubDriverOrders = null;
  }
}

// ---- Listen for active order updates ----
function startListeningActiveOrder() {
  stopListeningOrders(); // Don't listen to new orders while on a trip
  if (!STATE.driverActiveOrderId) return;
  if (_unsubDriverOrders) { _unsubDriverOrders(); }
  _unsubDriverOrders = onDocSnapshot('orders', STATE.driverActiveOrderId, handleDriverOrderUpdate);
}

// ---- Driver order update handler ----
function handleDriverOrderUpdate(order) {
  if (!order) return;
  if (order.status === 'cancelled') {
    STATE.driverActiveOrderId = null;
    saveState();
    _unsubDriverOrders && _unsubDriverOrders();
    _unsubDriverOrders = null;
    _show('d-active-order', false);
    updateDriverUI();
    startListeningOrders();
    showToast('Пассажир отменил поездку', 'warn');
    tg.HapticFeedback.notificationOccurred('warning');
  } else {
    renderActiveDriverOrder(order);
    // Show geo indicator
    if (order.geoEnabled && order.passengerGeo) {
      _show('d-geo-indicator', true);
      _setText('d-geo-coords', `${order.passengerGeo.lat.toFixed(5)}, ${order.passengerGeo.lng.toFixed(5)}`);
    } else {
      _show('d-geo-indicator', false);
    }
  }
}

// ---- Render available orders list ----
function renderDriverOrders(orders, mode) {
  const list = document.getElementById('d-orders-list');
  if (!list) return;
  if (!orders || !orders.length) {
    list.innerHTML = '<div class="empty-st"><div class="empty-ico">🔍</div><div class="empty-txt">Нет заказов. Обновляется автоматически.</div></div>';
    return;
  }
  if (mode === 'intercity') {
    // Intercity: show "Contact" button instead of Accept
    list.innerHTML = orders.map(o => `
      <div class="ord-card">
        <div class="ord-hdr">
          <div style="font-size:11px;color:var(--text3)">${fmtRelTime(o.createdAt)}</div>
          <span class="tag tag-y">${escHtml(o.icType || 'Межгород')}</span>
        </div>
        <div class="ord-route">
          <div class="ord-rrow"><div class="ord-rdot rdot-a"></div><div class="ord-rtxt"><strong>${escHtml(o.from)}</strong></div></div>
          <div class="ord-rrow"><div class="ord-rdot rdot-b"></div><div class="ord-rtxt"><strong>${escHtml(o.to)}</strong></div></div>
        </div>
        <div class="ord-tags">
          <span class="tag">📅 ${o.date || ''} ${o.time || ''}</span>
          ${o.comment ? `<span class="tag">💬 ${escHtml(o.comment.substring(0, 20))}${o.comment.length > 20 ? '...' : ''}</span>` : ''}
        </div>
        <div class="ord-bot">
          <div>
            <div style="font-size:10px;color:var(--text3)">Цена пассажира</div>
            <div class="offer-price">${fmtPrice(o.price)}₸</div>
          </div>
          <button class="btn btn-blue btn-sm" onclick="icDriverContact('${o.id}')">📞 Связаться</button>
        </div>
      </div>`).join('');
  } else {
    // City: show Offer / Accept buttons
    list.innerHTML = orders.map(o => `
      <div class="ord-card">
        <div class="ord-hdr">
          <div style="font-size:11px;color:var(--text3)">${fmtRelTime(o.createdAt)}</div>
          <div class="stars">⭐ <span style="font-size:12px;color:var(--text2)">${fmtRating(o.passengerRating)} пасс.</span></div>
        </div>
        <div class="ord-route">
          <div class="ord-rrow"><div class="ord-rdot rdot-a"></div><div class="ord-rtxt"><strong>${escHtml(o.from)}</strong>${o.fromEntrance ? ' · Подъезд ' + o.fromEntrance : ''}</div></div>
          <div class="ord-rrow"><div class="ord-rdot rdot-b"></div><div class="ord-rtxt"><strong>${escHtml(o.to)}</strong>${o.toEntrance ? ' · Подъезд ' + o.toEntrance : ''}</div></div>
        </div>
        <div class="ord-tags">
          <span class="tag">${o.payMethod === 'cash' ? '💵 Нал.' : '📲 Перевод'}</span>
          ${o.pax > 1 ? `<span class="tag">👥 ${o.pax}</span>` : ''}
          ${o.childSeat ? '<span class="tag">👶 Кресло</span>' : ''}
          ${o.geoEnabled ? '<span class="tag tag-g">📍 Гео</span>' : ''}
          ${o.comment ? `<span class="tag">💬 ${escHtml(o.comment.substring(0, 20))}${o.comment.length > 20 ? '...' : ''}</span>` : ''}
        </div>
        <div class="ord-bot">
          <div>
            <div style="font-size:10px;color:var(--text3)">Цена пассажира</div>
            <div class="offer-price">${fmtPrice(o.price)}₸</div>
          </div>
          <div style="display:flex;gap:7px">
            <button class="btn btn-ghost btn-sm" onclick="openDrvOffer('${o.id}',${o.price})">Предложить цену</button>
            <button class="btn btn-y btn-sm" onclick="drvAcceptOrder('${o.id}',${o.price})">Принять</button>
          </div>
        </div>
      </div>`).join('');
  }
}

// ---- Render active driver order ----
function renderActiveDriverOrder(order) {
  _setText('d-act-route', `${order.from} → ${order.to}`);
  _setText('d-act-meta', `${fmtPrice(order.acceptedPrice || order.price)}₸ · ${order.payMethod === 'cash' ? 'Наличные' : 'Перевод'}${order.comment ? ' · ' + order.comment : ''}`);
  _setText('d-act-pname', order.passengerName || '—');
  _setText('d-act-pphone', order.passengerPhone || '—');
  _setText('d-act-prating', fmtRating(order.passengerRating));
  _setText('d-act-price', fmtPrice(order.acceptedPrice || order.price) + '₸');

  const arrBtn = document.getElementById('btn-arrived');
  const startBtn = document.getElementById('btn-start-ride');
  const finishBtn = document.getElementById('btn-finish-ride');

  if (order.status === 'arrived') {
    if (arrBtn) { arrBtn.disabled = true; arrBtn.textContent = '✅ Прибыл'; }
    if (startBtn) startBtn.disabled = false;
    if (finishBtn) finishBtn.style.display = 'none';
  } else if (order.status === 'riding') {
    if (arrBtn) { arrBtn.disabled = true; arrBtn.textContent = '✅ Прибыл'; }
    if (startBtn) startBtn.disabled = true;
    if (finishBtn) finishBtn.style.display = 'block';
  } else {
    // status === 'active'
    if (arrBtn) { arrBtn.disabled = false; arrBtn.textContent = 'Я приехал 📍'; }
    if (startBtn) startBtn.disabled = true;
    if (finishBtn) finishBtn.style.display = 'none';
  }
}

// ---- Driver offer modal ----
function openDrvOffer(orderId, passengerPrice) {
  STATE.currentOfferOrderId = orderId;
  _setText('doi-pprice', fmtPrice(passengerPrice) + '₸');
  _setVal('doi-price', passengerPrice);
  _setVal('doi-eta', '10');
  openModal('mo-drv-offer');
}

async function submitOffer() {
  const price = parseInt(document.getElementById('doi-price').value);
  const eta = parseInt(document.getElementById('doi-eta').value);
  if (!price || price <= 0) { showToast('Укажите цену', 'err'); return; }
  if (!eta || eta < 1) { showToast('Укажите время прибытия', 'err'); return; }

  const order = await dbGet('orders', STATE.currentOfferOrderId);
  if (!order || order.status !== 'searching') {
    showToast('Заказ уже занят', 'warn');
    closeModal('mo-drv-offer');
    return;
  }
  const offer = {
    id: 'OFF-' + Date.now(),
    driverId: STATE.user.tgId,
    name: STATE.user.name,
    car: STATE.user.car ? `${STATE.user.car.brand} · ${STATE.user.car.num}` : '',
    rating: STATE.user.rating,
    price,
    eta
  };
  // Replace any existing offer from this driver
  const orderId = STATE.currentOfferOrderId;
  const newOffers = [...(order.offers || []).filter(o => o.driverId !== STATE.user.tgId), offer];
  await dbSet('orders', orderId, { offers: newOffers });
  watchPendingOffer(orderId);
  closeModal('mo-drv-offer');
  showToast('Предложение отправлено! Ожидайте выбора пассажира ⏳', 'ok');
}

// ---- Watch pending offer — notify driver when passenger accepts/rejects ----
function watchPendingOffer(orderId) {
  if (_pendingOfferListeners[orderId]) return; // already watching
  const unsub = onDocSnapshot('orders', orderId, order => {
    if (!order || order.status === 'cancelled') {
      stopWatchingOffer(orderId);
      return;
    }
    if (order.status === 'active') {
      stopWatchingOffer(orderId);
      if (order.acceptedDriver && order.acceptedDriver.driverId === STATE.user.tgId) {
        // Our offer was accepted!
        if (STATE.driverActiveOrderId) return; // already on a ride
        STATE.driverActiveOrderId = orderId;
        saveState();
        dbSet('driver_shifts', STATE.user.tgId + '_shift', { hasActiveOrder: true });
        stopListeningOrders();
        startListeningActiveOrder();
        _show('d-online-box', false);
        _show('d-active-order', true);
        renderActiveDriverOrder(order);
        showToast('Пассажир выбрал вас! Едьте к нему 🎉', 'ok');
        tg.HapticFeedback.notificationOccurred('success');
      } else {
        showToast('Пассажир выбрал другого водителя');
        tg.HapticFeedback.notificationOccurred('warning');
      }
    }
  });
  _pendingOfferListeners[orderId] = unsub;
}

function stopWatchingOffer(orderId) {
  if (_pendingOfferListeners[orderId]) {
    _pendingOfferListeners[orderId]();
    delete _pendingOfferListeners[orderId];
  }
}

// ---- Accept order (adds driver to offer list at passenger's price) ----
async function drvAcceptOrder(orderId, price) {
  if (STATE.driverActiveOrderId) {
    showToast('У вас уже есть активный заказ', 'warn'); return;
  }
  const order = await dbGet('orders', orderId);
  if (!order || order.status !== 'searching') {
    showToast('Заказ уже занят', 'warn'); return;
  }
  // Check if driver already submitted an offer for this order
  const existing = (order.offers || []).find(o => o.driverId === STATE.user.tgId);
  if (existing) {
    showToast('Вы уже отправили предложение', 'warn'); return;
  }
  const offer = {
    id: 'OFF-' + Date.now(),
    driverId: STATE.user.tgId,
    name: STATE.user.name,
    car: STATE.user.car ? `${STATE.user.car.color} ${STATE.user.car.brand} · ${STATE.user.car.num}` : '',
    rating: STATE.user.rating,
    price,
    eta: 5
  };
  const newOffers = [...(order.offers || []), offer];
  await dbSet('orders', orderId, { offers: newOffers });
  watchPendingOffer(orderId);
  showToast('Предложение отправлено! Ожидайте выбора пассажира ⏳', 'ok');
  tg.HapticFeedback.impactOccurred('light');
}

// ---- Driver arrived ----
async function driverArrived() {
  if (!STATE.driverActiveOrderId) return;
  await dbSet('orders', STATE.driverActiveOrderId, {
    status: 'arrived',
    arrivedAt: new Date().toISOString()
  });
  const arr = document.getElementById('btn-arrived');
  if (arr) { arr.disabled = true; arr.textContent = '✅ Прибыл'; }
  const start = document.getElementById('btn-start-ride');
  if (start) start.disabled = false;
  showToast('Пассажир уведомлён! 📍', 'ok');
  tg.HapticFeedback.impactOccurred('medium');
}

// ---- Start ride ----
async function startRide() {
  if (!STATE.driverActiveOrderId) return;
  await dbSet('orders', STATE.driverActiveOrderId, {
    status: 'riding',
    startedAt: new Date().toISOString()
  });
  const start = document.getElementById('btn-start-ride');
  if (start) start.disabled = true;
  const finish = document.getElementById('btn-finish-ride');
  if (finish) finish.style.display = 'block';
  showToast('Поездка началась! 🛣️', 'ok');
}

// ---- Finish ride ----
async function finishRide() {
  if (!STATE.driverActiveOrderId) return;
  const orderId = STATE.driverActiveOrderId;
  showLoading(true);

  await dbSet('orders', orderId, {
    status: 'done',
    finishedAt: new Date().toISOString()
  });

  // Increment driver trip counters
  STATE.user.trips = (STATE.user.trips || 0) + 1;
  STATE.user.driverTrips = (STATE.user.driverTrips || 0) + 1;
  STATE.shiftTrips = (STATE.shiftTrips || 0) + 1;
  STATE.user.bonusTrips = (STATE.user.bonusTrips || 0) + 1;

  // Bonus system
  if (STATE.user.bonusTrips >= BONUS_TRIPS && STATE.bonusSystemEnabled) {
    STATE.user.bonusTrips = 0;
    STATE.user.nextShiftFree = true;
    showToast('🎉 Следующая смена бесплатная!', 'ok');
  }

  await dbSet('users', STATE.user.tgId, {
    trips: STATE.user.trips,
    driverTrips: STATE.user.driverTrips,
    bonusTrips: STATE.user.bonusTrips,
    nextShiftFree: STATE.user.nextShiftFree || false
  });

  // Increment passenger trip count
  try {
    const order = await dbGet('orders', orderId);
    if (order && order.passengerId) {
      await dbIncrement('users', order.passengerId, 'trips');
      await dbIncrement('users', order.passengerId, 'passengerTrips');
    }
  } catch (e) { console.warn('[finishRide] passenger trips increment:', e); }

  await dbSet('driver_shifts', STATE.user.tgId + '_shift', { hasActiveOrder: false });

  STATE.driverActiveOrderId = null;
  saveState();

  if (_unsubDriverOrders) { _unsubDriverOrders(); _unsubDriverOrders = null; }
  _show('d-active-order', false);
  showLoading(false);
  updateDriverUI();
  updateAllUI();
  startListeningOrders();
  showToast('Поездка завершена! Спасибо! ✅', 'ok');
  setTimeout(() => openRatingModal('passenger', orderId), 700);
}

// ---- Driver cancel ride ----
async function driverCancelRide() {
  tg.showConfirm('Отменить поездку?', async ok => {
    if (!ok) return;
    if (STATE.driverActiveOrderId) {
      await dbSet('orders', STATE.driverActiveOrderId, {
        status: 'cancelled',
        cancelledBy: 'driver',
        cancelledAt: new Date().toISOString()
      });
      await dbSet('driver_shifts', STATE.user.tgId + '_shift', { hasActiveOrder: false });
      STATE.driverActiveOrderId = null;
      saveState();
      if (_unsubDriverOrders) { _unsubDriverOrders(); _unsubDriverOrders = null; }
    }
    _show('d-active-order', false);
    updateDriverUI();
    startListeningOrders();
    showToast('Поездка отменена');
  });
}

// ---- Shift management ----
async function goOnline() {
  if (!STATE.user.approved) {
    showToast('Аккаунт не подтверждён. Ожидайте проверки.', 'warn'); return;
  }
  if (STATE.user.blocked) {
    showToast('Ваш аккаунт заблокирован', 'err'); return;
  }
  const freeUntil = STATE.user.freeUntil ? new Date(STATE.user.freeUntil) : null;
  const isFree = freeUntil && freeUntil > new Date();
  const isNextFree = STATE.user.nextShiftFree;

  if (!isFree && !isNextFree) {
    const today = new Date().toDateString();
    if (STATE.paidToday !== today) {
      openTonPayment(); return;
    }
  }
  if (isNextFree) {
    STATE.user.nextShiftFree = false;
    await dbSet('users', STATE.user.tgId, { nextShiftFree: false });
  }

  const hour = new Date().getHours();
  const shiftUntil = hour >= 16
    ? new Date(Date.now() + 12 * 3600 * 1000)
    : new Date(new Date().setHours(23, 59, 59, 999));

  STATE.shiftActive = true;
  STATE.shiftUntil = shiftUntil.toISOString();
  STATE.shiftTrips = 0;
  saveState();

  await dbSet('driver_shifts', STATE.user.tgId + '_shift', {
    driverId: STATE.user.tgId,
    driverName: STATE.user.name,
    city: STATE.user.city,
    mode: STATE.driverMode || 'city',
    active: true,
    until: STATE.shiftUntil,
    hasActiveOrder: false,
    startedAt: new Date().toISOString()
  });

  clearTimeout(_shiftTimer);
  _shiftTimer = setTimeout(() => autoEndShift(), shiftUntil - Date.now());

  _show('d-offline-box', false);
  _show('d-online-box', true);
  updateDriverUI();
  startListeningOrders();
  showToast('Вы на линии 🟢', 'ok');
  tg.HapticFeedback.notificationOccurred('success');
}

async function goOffline() {
  tg.showConfirm('Завершить смену?', async ok => { if (ok) await endShift(); });
}

async function autoEndShift() {
  if (!STATE.shiftActive) return;
  await endShift();
  showToast('Смена завершена автоматически (время вышло)');
}

async function endShift() {
  clearTimeout(_shiftTimer);
  _shiftTimer = null;
  STATE.shiftActive = false;
  const prevShifts = STATE.user.totalShifts || 0;
  STATE.user.totalShifts = prevShifts + 1;
  STATE.user.avgShiftTrips = ((STATE.user.avgShiftTrips || 0) * prevShifts + (STATE.shiftTrips || 0)) / STATE.user.totalShifts;
  saveState();
  await dbSet('driver_shifts', STATE.user.tgId + '_shift', {
    active: false,
    endedAt: new Date().toISOString()
  });
  await dbSet('users', STATE.user.tgId, {
    totalShifts: STATE.user.totalShifts,
    avgShiftTrips: STATE.user.avgShiftTrips
  });
  stopListeningOrders();
  _show('d-offline-box', true);
  _show('d-online-box', false);
  updateDriverUI();
  showToast('Смена завершена ✅', 'ok');
}

// ---- Driver mode (city / intercity) ----
function selDrvMode(mode) {
  STATE.driverMode = mode;
  if (STATE.user) STATE.user.driverMode = mode;
  saveState();
  document.getElementById('d-mode-city').classList.toggle('on', mode === 'city');
  document.getElementById('d-mode-ic').classList.toggle('on', mode === 'intercity');
}

// ---- Driver UI state ----
function updateDriverUI() {
  const u = STATE.user;
  if (!u) return;
  const approved = u.approved !== false;
  _show('d-pending-box', !approved);
  _show('d-approved-box', approved);
  if (!approved) return;

  const hasActive = !!STATE.driverActiveOrderId;
  _show('d-offline-box', !STATE.shiftActive && !hasActive);
  _show('d-online-box', STATE.shiftActive && !hasActive);
  _show('d-active-order', hasActive);

  if (STATE.shiftActive && STATE.shiftUntil) {
    _setText('d-shift-until', 'До ' + fmtTime(STATE.shiftUntil));
  }
  _setText('d-shift-trips', STATE.shiftTrips || 0);
  _setText('d-avg-trips', u.avgShiftTrips ? u.avgShiftTrips.toFixed(1) : '—');

  const bonusEnabled = STATE.bonusSystemEnabled;
  _show('d-bonus-row', bonusEnabled);
  if (bonusEnabled) {
    _setText('d-bonus-left', Math.max(0, BONUS_TRIPS - (STATE.shiftTrips || 0)));
  }

  // Pay warning
  const freeUntil = u.freeUntil ? new Date(u.freeUntil) : null;
  const isFree = freeUntil && freeUntil > new Date();
  _show('d-pay-warning', !isFree);
}

// ---- Driver history ----
async function renderDHistory() {
  const list = document.getElementById('d-hist-list');
  if (!list) return;
  list.innerHTML = '<div class="empty-st"><div class="empty-ico">⏳</div><div class="empty-txt">Загрузка...</div></div>';
  try {
    // Query all done orders and filter client-side (Firestore needs composite index for two-field query)
    const orders = await dbQuery('orders', 'status', '==', 'done');
    const mine = orders
      .filter(o => o.acceptedDriver && o.acceptedDriver.driverId === STATE.user.tgId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (!mine.length) {
      list.innerHTML = '<div class="empty-st"><div class="empty-ico">📋</div><div class="empty-txt">Поездок пока нет</div></div>';
      return;
    }
    list.innerHTML = mine.map(o => `
      <div class="hist-card">
        <div class="hist-hdr">
          <div class="hist-date">${fmtDate(o.createdAt)}</div>
          <div class="hist-price">${fmtPrice(o.acceptedPrice || o.price)}₸</div>
        </div>
        <div class="hist-route">${escHtml(o.from)} → ${escHtml(o.to)}</div>
        <span class="hist-b hb-ok">✓ Завершена</span>
      </div>`).join('');
  } catch (e) {
    list.innerHTML = '<div class="empty-st"><div class="empty-ico">⚠️</div><div class="empty-txt">Ошибка загрузки</div></div>';
  }
}

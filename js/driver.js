/* ============================================================
   DRIVER — Orders, shift management, active ride, passenger map
   Fixes:
     - startListeningOrders / stopListeningOrders don't conflict
     - Passenger trip count incremented on finishRide
     - Shift auto-end timeout uses proper JS timer
     - Driver history uses correct query
   ============================================================ */

let _unsubDriverOrders = null;
let _shiftTimer = null;
const _pendingOfferListeners = {}; // orderId -> unsubFn
const _pendingOfferData = {};      // orderId -> {offerTime, price}
let _driverOfferCountdown = null;  // interval for countdown bars

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
    // Don't disrupt open offer modal
    const offerModal = document.getElementById('mo-drv-offer');
    if (offerModal && offerModal.classList.contains('open')) return;
    // Filter by city and driver mode
    const mode = (STATE.user && STATE.user.driverMode) || STATE.driverMode || 'city';
    const city = STATE.user ? STATE.user.city : '';
    const icCity = STATE.driverIcCity || city;
    const filtered = orders.filter(o => {
      if (mode === 'intercity') {
        if (o.type !== 'intercity') return false;
        return (o.icFromCity || o.city) === icCity;
      }
      return o.city === city && o.type !== 'intercity';
    });
    renderDriverOrders(filtered, mode);
  });
}

function stopListeningOrders() {
  if (_unsubDriverOrders) {
    _unsubDriverOrders();
    _unsubDriverOrders = null;
  }
  // Clean up any pending offer watches
  Object.keys(_pendingOfferListeners).forEach(stopWatchingOffer);
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

// ---- Build card HTML (no DOM ops) ----
function _buildIcCardHtml(o) {
  return `
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
      ${o.comment ? `<span class="tag">💬 ${escHtml(o.comment.substring(0,20))}${o.comment.length>20?'...':''}</span>` : ''}
    </div>
    <div class="ord-bot">
      <div><div style="font-size:10px;color:var(--text3)">Цена пассажира</div><div class="offer-price">${fmtPrice(o.price)}₸</div></div>
      <button class="btn btn-blue btn-sm" onclick="icDriverContact('${o.id}')">📞 Связаться</button>
    </div>`;
}

function _buildCityCardHtml(o) {
  const pd = _pendingOfferData[o.id];
  const OFFER_TTL = 10000;
  let botHtml;
  if (pd) {
    const rem = Math.max(0, OFFER_TTL - (Date.now() - new Date(pd.offerTime).getTime()));
    const pct = rem / OFFER_TTL * 100;
    botHtml = `
      <div class="ord-bot" style="flex-direction:column;gap:6px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><div style="font-size:10px;color:var(--text3)">Ваше предложение</div><div class="offer-price">${fmtPrice(pd.price)}₸</div></div>
          <span class="tag tag-g">⏳ Ожидание пассажира</span>
        </div>
        <div class="offer-progress-wrap"><div class="offer-progress-bar" id="dopb-${o.id}" style="width:${pct.toFixed(1)}%"></div></div>
      </div>`;
  } else {
    botHtml = `
      <div class="ord-bot">
        <div><div style="font-size:10px;color:var(--text3)">Цена пассажира</div><div class="offer-price">${fmtPrice(o.price)}₸</div></div>
        <div style="display:flex;gap:7px">
          <button class="btn btn-ghost btn-sm" onclick="openDrvOffer('${o.id}',${o.price})">Предложить цену</button>
          <button class="btn btn-y btn-sm" onclick="drvAcceptOrder('${o.id}',${o.price})">Принять</button>
        </div>
      </div>`;
  }
  return `
    <div class="ord-hdr">
      <div style="font-size:11px;color:var(--text3)">${fmtRelTime(o.createdAt)}</div>
      <div class="stars">⭐ <span style="font-size:12px;color:var(--text2)">${fmtRating(o.passengerRating)} пасс.</span></div>
    </div>
    <div class="ord-route">
      <div class="ord-rrow"><div class="ord-rdot rdot-a"></div><div class="ord-rtxt"><strong>${escHtml(o.from)}</strong>${o.fromEntrance ? ' · Подъезд '+o.fromEntrance : ''}</div></div>
      <div class="ord-rrow"><div class="ord-rdot rdot-b"></div><div class="ord-rtxt"><strong>${escHtml(o.to)}</strong>${o.toEntrance ? ' · Подъезд '+o.toEntrance : ''}</div></div>
    </div>
    <div class="ord-tags">
      <span class="tag">${o.payMethod==='cash'?'💵 Нал.':'📲 Перевод'}</span>
      ${o.pax>1?`<span class="tag">👥 ${o.pax}</span>`:''}
      ${o.childSeat?'<span class="tag">👶 Кресло</span>':''}
      ${o.geoEnabled?'<span class="tag tag-g">📍 Гео</span>':''}
      ${o.comment?`<span class="tag">💬 ${escHtml(o.comment.substring(0,20))}${o.comment.length>20?'...':''}</span>`:''}
    </div>
    ${botHtml}`;
}

// ---- Fade-out then remove helper ----
function _fadeOutRemove(el) {
  el.style.transition = 'opacity .25s, transform .25s';
  el.style.opacity = '0';
  el.style.transform = 'translateY(-8px)';
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 270);
}

// ---- Render available orders list (DOM-diff — no flicker) ----
function renderDriverOrders(orders, mode) {
  const list = document.getElementById('d-orders-list');
  if (!list) return;

  if (!orders || !orders.length) {
    const existing = list.querySelectorAll('.ord-card[data-oid]');
    if (existing.length) {
      existing.forEach(c => _fadeOutRemove(c));
      setTimeout(() => {
        if (!list.querySelector('.ord-card[data-oid]')) {
          list.innerHTML = '<div class="empty-st"><div class="empty-ico">🔍</div><div class="empty-txt">Нет заказов. Обновляется автоматически.</div></div>';
        }
      }, 300);
    } else {
      list.innerHTML = '<div class="empty-st"><div class="empty-ico">🔍</div><div class="empty-txt">Нет заказов. Обновляется автоматически.</div></div>';
    }
    _stopDriverOfferCountdown();
    return;
  }

  // Remove empty-state placeholder if present
  const emptyEl = list.querySelector('.empty-st');
  if (emptyEl) emptyEl.remove();

  const newIds = new Set(orders.map(o => o.id));

  // Remove cards no longer in list
  list.querySelectorAll('.ord-card[data-oid]').forEach(card => {
    if (!newIds.has(card.dataset.oid)) _fadeOutRemove(card);
  });

  // Add new cards / rebuild cards whose pending-offer state changed
  const existingCards = {};
  list.querySelectorAll('.ord-card[data-oid]').forEach(c => existingCards[c.dataset.oid] = c);

  orders.forEach(o => {
    const hasPending = !!_pendingOfferData[o.id];
    if (!existingCards[o.id]) {
      // New card — create and fade in
      const card = document.createElement('div');
      card.className = 'ord-card';
      card.dataset.oid = o.id;
      card._fullOrder = o; // Store full order data for countdown expiry rebuild
      card.innerHTML = mode === 'intercity' ? _buildIcCardHtml(o) : _buildCityCardHtml(o);
      card.style.opacity = '0';
      card.style.transform = 'translateY(10px)';
      list.appendChild(card);
      requestAnimationFrame(() => {
        card.style.transition = 'opacity .25s, transform .25s';
        card.style.opacity = '1';
        card.style.transform = 'none';
      });
    } else {
      // Existing card — always update _fullOrder, rebuild bottom section if pending state changed
      existingCards[o.id]._fullOrder = o;
      const wasShowingPending = !!existingCards[o.id].querySelector('.offer-progress-wrap');
      if (wasShowingPending !== hasPending) {
        existingCards[o.id].innerHTML = mode === 'intercity' ? _buildIcCardHtml(o) : _buildCityCardHtml(o);
      }
    }
  });

  // Manage countdown for pending offers
  if (Object.keys(_pendingOfferData).length > 0) {
    _startDriverOfferCountdown();
  }
}

// ---- Driver offer countdown ticker ----
function _startDriverOfferCountdown() {
  if (_driverOfferCountdown) return;
  const OFFER_TTL = 10000;
  _driverOfferCountdown = setInterval(() => {
    const nowMs = Date.now();
    let anyActive = false;
    Object.entries(_pendingOfferData).forEach(([orderId, pd]) => {
      const rem = Math.max(0, OFFER_TTL - (nowMs - new Date(pd.offerTime).getTime()));
      const bar = document.getElementById('dopb-' + orderId);
      if (bar) { bar.style.width = (rem / OFFER_TTL * 100).toFixed(1) + '%'; anyActive = true; }
      if (rem <= 0) {
        // Offer expired — only clear pending state; the next Firestore snapshot
        // will provide the full order data and rebuild the card correctly
        delete _pendingOfferData[orderId];
        // Visually revert: hide progress bar, re-show action buttons in-place
        const bar = document.getElementById('dopb-' + orderId);
        const card = bar ? bar.closest('.ord-card') : null;
        if (card && card._fullOrder) {
          card.innerHTML = _buildCityCardHtml(card._fullOrder);
        } else if (card) {
          // Full order data not available — just remove the progress area so user sees it expired
          const progWrap = card.querySelector('.offer-progress-wrap');
          if (progWrap) progWrap.remove();
          const pendingTag = card.querySelector('.tag-g');
          if (pendingTag && pendingTag.textContent.includes('Ожидание')) pendingTag.remove();
        }
      }
    });
    if (!anyActive && Object.keys(_pendingOfferData).length === 0) _stopDriverOfferCountdown();
  }, 500);
}

function _stopDriverOfferCountdown() {
  if (_driverOfferCountdown) { clearInterval(_driverOfferCountdown); _driverOfferCountdown = null; }
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
  STATE.currentOfferPassengerPrice = passengerPrice;
  _setText('doi-pprice', fmtPrice(passengerPrice) + '₸');
  _setVal('doi-price', passengerPrice + 50);
  // Reset to 5 min radio
  const r5 = document.querySelector('input[name="doi-eta"][value="5"]');
  if (r5) r5.checked = true;
  openModal('mo-drv-offer');
}

function adjOfferPrice(delta) {
  const el = document.getElementById('doi-price');
  if (!el) return;
  const minPrice = STATE.currentOfferPassengerPrice || 0;
  const cur = parseInt(el.value) || (minPrice + 50);
  el.value = Math.max(minPrice, cur + delta);
}

async function submitOffer() {
  const price = parseInt(document.getElementById('doi-price').value);
  const minPrice = STATE.currentOfferPassengerPrice || 0;
  if (!price || price < minPrice) {
    showToast(`Цена не может быть ниже ${fmtPrice(minPrice)}₸`, 'err'); return;
  }
  const etaEl = document.querySelector('input[name="doi-eta"]:checked');
  const eta = etaEl ? parseInt(etaEl.value) : 5;
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
    eta,
    offerTime: new Date().toISOString()
  };
  // Replace any existing offer from this driver
  const orderId = STATE.currentOfferOrderId;
  const newOffers = [...(order.offers || []).filter(o => o.driverId !== STATE.user.tgId), offer];
  await dbSet('orders', orderId, { offers: newOffers });
  // Store pending offer data for countdown display
  _pendingOfferData[orderId] = { offerTime: offer.offerTime, price };
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
  // Clear pending offer data so card reverts to normal buttons
  if (_pendingOfferData[orderId]) {
    delete _pendingOfferData[orderId];
    if (Object.keys(_pendingOfferData).length === 0) _stopDriverOfferCountdown();
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
    eta: 5,
    offerTime: new Date().toISOString()
  };
  const newOffers = [...(order.offers || []), offer];
  await dbSet('orders', orderId, { offers: newOffers });
  // Store pending offer data for countdown display
  _pendingOfferData[orderId] = { offerTime: offer.offerTime, price };
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

  // Read order first to calculate duration and finalAmount
  let durationSeconds = null;
  let finalAmount = 0;
  try {
    const orderSnap = await dbGet('orders', orderId);
    if (orderSnap) {
      finalAmount = orderSnap.acceptedPrice || orderSnap.price || 0;
      if (orderSnap.startedAt) {
        durationSeconds = Math.round((Date.now() - new Date(orderSnap.startedAt).getTime()) / 1000);
      }
    }
  } catch (e) { console.warn('[finishRide] pre-read:', e); }

  const finishedAt = new Date().toISOString();
  await dbSet('orders', orderId, {
    status: 'done',
    finishedAt,
    durationSeconds,
    finalAmount
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

  // Earnings + daily stats
  try {
    const order = await dbGet('orders', orderId);
    const earnedPrice = finalAmount || (order && (order.acceptedPrice || order.price)) || 0;
    const today = new Date().toDateString();
    if (STATE.user.lastStatsDate !== today) {
      STATE.user.driverTripsToday = 0;
      STATE.user.driverEarningsToday = 0;
      STATE.user.lastStatsDate = today;
    }
    STATE.user.driverTripsToday = (STATE.user.driverTripsToday || 0) + 1;
    STATE.user.driverEarnings = (STATE.user.driverEarnings || 0) + earnedPrice;
    STATE.user.driverEarningsToday = (STATE.user.driverEarningsToday || 0) + earnedPrice;

    if (order && order.passengerId) {
      await dbIncrement('users', order.passengerId, 'trips');
      await dbIncrement('users', order.passengerId, 'passengerTrips');
    }
  } catch (e) { console.warn('[finishRide] passenger trips / earnings:', e); }

  await dbSet('users', STATE.user.tgId, {
    trips: STATE.user.trips,
    driverTrips: STATE.user.driverTrips,
    bonusTrips: STATE.user.bonusTrips,
    nextShiftFree: STATE.user.nextShiftFree || false,
    driverEarnings: STATE.user.driverEarnings || 0,
    driverEarningsToday: STATE.user.driverEarningsToday || 0,
    driverTripsToday: STATE.user.driverTripsToday || 0,
    lastStatsDate: new Date().toDateString()
  });

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
        cancelledAt: new Date().toISOString(),
        cancelReason: ''
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
  if (STATE.user.blockedAsDriver || STATE.user.blocked) {
    showToast('Ваш аккаунт водителя заблокирован', 'err'); return;
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
  // Clean up any pending offer watches
  Object.keys(_pendingOfferListeners).forEach(stopWatchingOffer);
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

// ---- Driver intercity city picker ----
function openDriverIcCityPicker() {
  const list = document.getElementById('drv-ic-city-list');
  if (list) {
    let html = '';
    (window.COUNTRIES || []).forEach(c => {
      (c.cities || []).forEach(city => {
        const cityEsc = city.replace(/'/g, "\\'");
        const countryEsc = c.name.replace(/'/g, "\\'");
        html += `<button class="btn btn-out" style="margin-bottom:6px;text-align:left;width:100%" onclick="selDriverIcCity('${cityEsc}','${countryEsc}')"><strong>${city}</strong> <span style="color:var(--text3);font-size:11px">${c.name}</span></button>`;
      });
    });
    list.innerHTML = html || '<div style="padding:20px;text-align:center;color:var(--text3)">Нет данных</div>';
  }
  openModal('mo-drv-ic-city');
}

function selDriverIcCity(city, country) {
  STATE.driverIcCity = city;
  STATE.driverIcCountry = country;
  saveState();
  _setText('d-ic-city-label', city);
  closeModal('mo-drv-ic-city');
  stopListeningOrders();
  startListeningOrders();
  showToast('Город: ' + city + ' ✅', 'ok');
}

// ---- Driver mode (city / intercity) ----
function selDrvMode(mode) {
  STATE.driverMode = mode;
  if (STATE.user) STATE.user.driverMode = mode;
  saveState();
  document.getElementById('d-mode-city').classList.toggle('on', mode === 'city');
  document.getElementById('d-mode-ic').classList.toggle('on', mode === 'intercity');
  const icRow = document.getElementById('d-ic-city-row');
  if (icRow) icRow.style.display = mode === 'intercity' ? 'block' : 'none';
  if (mode === 'intercity' && !STATE.driverIcCity && STATE.user) {
    STATE.driverIcCity = STATE.user.city;
    _setText('d-ic-city-label', STATE.user.city || '—');
  }
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
  const today = new Date().toDateString();
  if (u.lastStatsDate && u.lastStatsDate !== today) {
    u.driverTripsToday = 0;
    u.driverEarningsToday = 0;
  }
  _setText('dp-trips-today', u.driverTripsToday || 0);
  _setText('dp-earnings-today', fmtPrice(u.driverEarningsToday || 0) + '₸');
  _setText('dp-earnings-total', fmtPrice(u.driverEarnings || 0) + '₸');
  _setText('d-ic-city-label', STATE.driverIcCity || u.city || '—');

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

// ---- Passenger map ----
let _passengerMap = null;
let _passengerMarker = null;
let _mapOrderUnsub = null;

function openPassengerMap() {
  STATE.mapFrom = STATE.role === 'driver' ? 's-driver' : null;
  showScreen('s-passenger-map');

  // Init map after screen is visible
  setTimeout(() => {
    const mapEl = document.getElementById('passenger-map');
    if (!mapEl) return;

    // Default coords (will be updated by real geo)
    const defaultLat = 51.18;
    const defaultLng = 71.45;

    if (!_passengerMap) {
      _passengerMap = L.map('passenger-map', { zoomControl: true }).setView([defaultLat, defaultLng], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19
      }).addTo(_passengerMap);

      // Custom yellow marker
      const icon = L.divIcon({
        html: '<div style="background:var(--y,#f5c518);width:20px;height:20px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
        className: ''
      });
      _passengerMarker = L.marker([defaultLat, defaultLng], { icon }).addTo(_passengerMap);
      _passengerMarker.bindPopup('📍 Пассажир').openPopup();
    } else {
      _passengerMap.invalidateSize();
    }

    // Sync button states based on current order status
    _syncMapButtons();

    // Subscribe to order updates for live geo
    if (STATE.driverActiveOrderId) {
      if (_mapOrderUnsub) _mapOrderUnsub();
      _mapOrderUnsub = onDocSnapshot('orders', STATE.driverActiveOrderId, order => {
        if (!order) return;
        _syncMapButtons(order);
        if (order.passengerGeo) {
          const { lat, lng } = order.passengerGeo;
          const pos = [lat, lng];
          _passengerMarker.setLatLng(pos);
          _passengerMap.panTo(pos);
          _passengerMarker.getPopup() && _passengerMarker.openPopup();
          // Update coords text on driver screen too
          _setText('d-geo-coords', `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
        }
      });
    }
  }, 150);
}

function closePassengerMap() {
  if (_mapOrderUnsub) { _mapOrderUnsub(); _mapOrderUnsub = null; }
  if (_passengerMap) { _passengerMap.remove(); _passengerMap = null; _passengerMarker = null; }
  showScreen('s-driver');
}

function _syncMapButtons(order) {
  // Determine order status — use passed order or infer from STATE
  const status = order ? order.status : (STATE.driverActiveOrderId ? 'active' : null);
  const arrivedBtn = document.getElementById('map-btn-arrived');
  const startBtn = document.getElementById('map-btn-start');
  if (!arrivedBtn || !startBtn) return;
  if (status === 'active') {
    arrivedBtn.disabled = false;
    startBtn.disabled = true;
  } else if (status === 'arrived') {
    arrivedBtn.disabled = true;
    arrivedBtn.textContent = '✅ Прибыл';
    startBtn.disabled = false;
  } else if (status === 'riding') {
    arrivedBtn.disabled = true;
    startBtn.disabled = true;
  }
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

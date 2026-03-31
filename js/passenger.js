/* ============================================================
   PASSENGER — Order creation, offers, active ride
   Fixes:
     - Passenger trip count incremented on ride complete
     - Geo stops when ride starts (status='riding')
     - Offer auto-removed if driver cancels before passenger
   ============================================================ */

let _unsubPassengerOrder = null;

// ---- Init listener ----
function setupPassengerListeners() {
  updateOnlineCount();
  // Refresh online count every 30s
  clearInterval(window._ocInterval);
  window._ocInterval = setInterval(updateOnlineCount, 30000);

  if (STATE.activeOrderId) {
    _unsubPassengerOrder = onDocSnapshot('orders', STATE.activeOrderId, handleOrderUpdate);
    checkActiveOrderStatus();
  } else {
    _show('p-new-order', true);
    _show('p-searching', false);
    _show('p-active-ride', false);
  }
}

// ---- Check state on tab switch ----
async function checkActiveOrderStatus() {
  if (!STATE.activeOrderId) {
    _show('p-new-order', true);
    _show('p-searching', false);
    _show('p-active-ride', false);
    return;
  }
  const order = await dbGet('orders', STATE.activeOrderId);
  if (!order || ['cancelled', 'done'].includes(order.status)) {
    STATE.activeOrderId = null;
    saveState();
    _show('p-new-order', true);
    _show('p-searching', false);
    _show('p-active-ride', false);
    return;
  }
  if (order.status === 'searching') {
    _show('p-searching', true);
    _show('p-new-order', false);
    _show('p-active-ride', false);
    renderOffers(order);
    updateAob(order);
  } else if (['active', 'arrived', 'riding'].includes(order.status)) {
    _show('p-active-ride', true);
    _show('p-new-order', false);
    _show('p-searching', false);
    updateActiveRide(order);
  }
}

// ---- Real-time order update handler ----
function handleOrderUpdate(order) {
  if (!order) return;
  const showOnly = id => {
    ['p-new-order', 'p-searching', 'p-active-ride'].forEach(i => _show(i, i === id));
  };
  if (order.status === 'searching') {
    showOnly('p-searching');
    renderOffers(order);
    updateAob(order);
  } else if (['active', 'arrived', 'riding'].includes(order.status)) {
    showOnly('p-active-ride');
    updateActiveRide(order);
  } else if (order.status === 'done') {
    STATE.activeOrderId = null;
    STATE.arrivalAcknowledged = false;
    saveState();
    if (_unsubPassengerOrder) { _unsubPassengerOrder(); _unsubPassengerOrder = null; }
    showOnly('p-new-order');
    stopArrivalSound();
    stopGeoTransmit();
    showToast('Поездка завершена! ✅', 'ok');
    tg.HapticFeedback.notificationOccurred('success');
    setTimeout(() => openRatingModal('driver', order.id), 700);
  } else if (order.status === 'cancelled') {
    STATE.activeOrderId = null;
    saveState();
    if (_unsubPassengerOrder) { _unsubPassengerOrder(); _unsubPassengerOrder = null; }
    showOnly('p-new-order');
    stopArrivalSound();
    stopGeoTransmit();
    showToast('Заказ отменён');
  }
}

// ---- Active order box ----
function updateAob(order) {
  _setText('p-aob-route', `${order.from} → ${order.to}`);
  _setText('p-aob-meta', `${fmtPrice(order.price)}₸ · ${order.payMethod === 'cash' ? 'Наличные' : 'Перевод'}`);
}

// ---- Render offers list ----
function renderOffers(order) {
  const list = document.getElementById('p-offers-list');
  const titleEl = document.getElementById('p-offers-title');
  const offers = order.offers || [];
  if (!list) return;
  if (!offers.length) {
    if (titleEl) titleEl.style.display = 'none';
    list.innerHTML = '';
    return;
  }
  if (titleEl) titleEl.style.display = 'block';
  list.innerHTML = offers.map(o => `
    <div class="offer-card">
      <div style="display:flex;align-items:center;gap:11px">
        <div class="drv-av">🚗</div>
        <div style="flex:1">
          <div class="offer-name">${escHtml(o.name)}</div>
          <div class="offer-meta">
            <div class="stars">⭐ ${fmtRating(o.rating)}</div>
            <div class="offer-car">${escHtml(o.car || '')}</div>
          </div>
        </div>
        <div style="text-align:right">
          <div class="offer-price">${fmtPrice(o.price)}₸</div>
          <div class="offer-eta">~${o.eta} мин</div>
        </div>
      </div>
      <div class="offer-acts">
        <button class="btn btn-green btn-sm" onclick="acceptOffer('${o.id}','${order.id}')">✓ Принять</button>
        <button class="btn btn-ghost btn-sm" onclick="declineOffer('${o.id}','${order.id}')">✗ Отклонить</button>
      </div>
    </div>`).join('');
}

// ---- Active ride display ----
function updateActiveRide(order) {
  _setText('p-ride-route', `${order.from} → ${order.to}`);
  const drv = order.acceptedDriver;
  if (drv) {
    const av = document.getElementById('p-ride-drv-av');
    if (av) av.textContent = '🚗';
    _setText('p-ride-drv-name', drv.name);
    _setText('p-ride-drv-car', drv.car || '');
    _setText('p-ride-drv-rating', fmtRating(drv.rating));
    _setText('p-ride-price', fmtPrice(drv.price) + '₸');
    _setText('p-ride-meta', `Водитель: ${drv.name}`);
  }
  const alertEl = document.getElementById('p-arrival-alert');
  const spillEl = document.getElementById('p-ride-spill');
  const statusEl = document.getElementById('p-ride-status');

  if (order.status === 'arrived') {
    if (statusEl) statusEl.textContent = '🚗 Водитель прибыл!';
    if (spillEl) spillEl.className = 'spill sp-arrived';
    // Only show alert and play sound if passenger hasn't acknowledged yet
    const acknowledged = order.passengerBoarded || STATE.arrivalAcknowledged;
    if (alertEl) alertEl.style.display = acknowledged ? 'none' : 'block';
    _setText('p-ride-eta', acknowledged ? '🚶 Выходите' : '✅ Ожидает вас');
    if (!acknowledged) startArrivalSound();
    else stopArrivalSound();
  } else if (order.status === 'riding') {
    if (statusEl) statusEl.textContent = '🛣️ Поездка началась';
    if (spillEl) spillEl.className = 'spill sp-active';
    if (alertEl) alertEl.style.display = 'none';
    stopArrivalSound();
    stopGeoTransmit(); // Stop geo when ride starts
  } else {
    if (alertEl) alertEl.style.display = 'none';
    if (spillEl) spillEl.className = 'spill sp-active';
    if (statusEl) statusEl.textContent = '🚗 Водитель едет к вам';
    _setText('p-ride-eta', drv ? `~${drv.eta} мин` : '');
    if (STATE.geoEnabled && order.id) startGeoTransmit(order.id);
  }
}

// ---- Online count ----
async function updateOnlineCount() {
  if (!STATE.user) return;
  try {
    const shifts = await dbQuery('driver_shifts', 'city', '==', STATE.user.city);
    const now = new Date();
    const active = shifts.filter(s => s.active && new Date(s.until) > now && s.mode === 'city');
    const free = active.filter(s => !s.hasActiveOrder);
    _setText('oc-total', active.length);
    _setText('oc-free', free.length);
  } catch (e) {
    // Fallback: show plausible numbers
    const t = document.getElementById('oc-total');
    const f = document.getElementById('oc-free');
    if (t && !t.textContent.match(/^\d+$/)) t.textContent = '—';
    if (f && !f.textContent.match(/^\d+$/)) f.textContent = '—';
  }
}

// ---- Create order ----
async function createOrder() {
  if (!STATE.fromAddr) { showToast('Укажите откуда', 'err'); return; }
  if (!STATE.toAddr) { showToast('Укажите куда', 'err'); return; }
  const price = parseInt(document.getElementById('p-price').value);
  if (!price || price <= 0) { showToast('Укажите цену', 'err'); return; }

  if (STATE.user.blocked) { showToast('Ваш аккаунт заблокирован', 'err'); return; }

  const btn = document.getElementById('btn-create-order');
  btn.disabled = true;
  showLoading(true);

  const orderId = 'ORD-' + Date.now();
  const order = {
    id: orderId,
    passengerId: STATE.user.tgId,
    passengerName: STATE.user.name,
    passengerPhone: STATE.user.phone,
    passengerRating: STATE.user.rating,
    from: STATE.fromAddr.address,
    fromEntrance: STATE.fromAddr.entrance || '',
    to: STATE.toAddr.address,
    toEntrance: STATE.toAddr.entrance || '',
    pax: STATE.pax,
    childSeat: STATE.childSeat,
    payMethod: STATE.payMethod,
    price,
    comment: document.getElementById('p-comment').value.trim(),
    geoEnabled: STATE.geoEnabled,
    status: 'searching',
    offers: [],
    city: STATE.user.city,
    type: 'city',
    createdAt: new Date().toISOString(),
  };

  try {
    await dbSet('orders', orderId, order);
    STATE.activeOrderId = orderId;
    saveState();

    if (_unsubPassengerOrder) _unsubPassengerOrder();
    _unsubPassengerOrder = onDocSnapshot('orders', orderId, handleOrderUpdate);

    _show('p-new-order', false);
    _show('p-searching', true);
    updateAob(order);

    if (STATE.geoEnabled) startGeoTransmit(orderId);
    showToast('Заказ создан! Ищем водителя... 🔍', 'ok');
    tg.HapticFeedback.impactOccurred('medium');
  } catch (e) {
    console.error(e);
    showToast('Ошибка создания заказа', 'err');
  }
  showLoading(false);
  btn.disabled = false;
}

// ---- Cancel order (searching phase) ----
async function cancelOrder() {
  tg.showConfirm('Отменить заказ?', async ok => {
    if (!ok) return;
    if (STATE.activeOrderId) {
      await dbSet('orders', STATE.activeOrderId, {
        status: 'cancelled',
        cancelledBy: 'passenger',
        cancelledAt: new Date().toISOString()
      });
      STATE.activeOrderId = null;
      saveState();
      if (_unsubPassengerOrder) { _unsubPassengerOrder(); _unsubPassengerOrder = null; }
      stopGeoTransmit();
    }
    _show('p-searching', false);
    _show('p-new-order', true);
    showToast('Заказ отменён');
  });
}

// ---- Accept offer ----
async function acceptOffer(offerId, orderId) {
  const order = await dbGet('orders', orderId);
  if (!order || order.status !== 'searching') {
    showToast('Заказ уже не актуален', 'warn'); return;
  }
  const offer = (order.offers || []).find(o => o.id === offerId);
  if (!offer) return;
  // Make sure driverId is explicitly set so watchPendingOffer on driver side works
  const acceptedDriver = { ...offer, driverId: offer.driverId };
  await dbSet('orders', orderId, {
    status: 'active',
    acceptedDriver,
    acceptedPrice: offer.price,
    acceptedAt: new Date().toISOString(),
    offers: []
  });
  showToast(`${escHtml(offer.name)} едет к вам! ~${offer.eta} мин ✅`, 'ok');
  tg.HapticFeedback.notificationOccurred('success');
}

// ---- Decline offer ----
async function declineOffer(offerId, orderId) {
  const order = await dbGet('orders', orderId);
  if (!order) return;
  const newOffers = (order.offers || []).filter(o => o.id !== offerId);
  await dbSet('orders', orderId, { offers: newOffers });
  showToast('Предложение отклонено');
}

// ---- Passenger boarded (hide arrival alert) ----
async function passengerBoarded() {
  stopArrivalSound();
  STATE.arrivalAcknowledged = true;
  saveState();
  _show('p-arrival-alert', false);
  // Mark in order so sound doesn't restart on re-render
  if (STATE.activeOrderId) {
    await dbSet('orders', STATE.activeOrderId, { passengerBoarded: true });
  }
  showToast('Отлично! Приятной поездки 🚗', 'ok');
  tg.HapticFeedback.notificationOccurred('success');
}

// ---- Cancel active ride (passenger side) ----
async function passengerCancelRide() {
  tg.showConfirm('Отменить поездку?', async ok => {
    if (!ok) return;
    if (STATE.activeOrderId) {
      await dbSet('orders', STATE.activeOrderId, {
        status: 'cancelled',
        cancelledBy: 'passenger',
        cancelledAt: new Date().toISOString()
      });
      STATE.activeOrderId = null;
      saveState();
      if (_unsubPassengerOrder) { _unsubPassengerOrder(); _unsubPassengerOrder = null; }
      stopArrivalSound();
      stopGeoTransmit();
    }
    _show('p-active-ride', false);
    _show('p-new-order', true);
    showToast('Поездка отменена');
  });
}

// ---- History ----
async function renderPHistory() {
  const list = document.getElementById('p-hist-list');
  if (!list) return;
  list.innerHTML = '<div class="empty-st"><div class="empty-ico">⏳</div><div class="empty-txt">Загрузка...</div></div>';
  try {
    const orders = await dbQuery('orders', 'passengerId', '==', STATE.user.tgId);
    const done = orders
      .filter(o => ['done', 'cancelled'].includes(o.status))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (!done.length) {
      list.innerHTML = '<div class="empty-st"><div class="empty-ico">📋</div><div class="empty-txt">Поездок пока нет</div></div>';
      return;
    }
    list.innerHTML = done.map(o => `
      <div class="hist-card">
        <div class="hist-hdr">
          <div class="hist-date">${fmtDate(o.createdAt)}</div>
          <div class="hist-price">${fmtPrice(o.acceptedDriver ? o.acceptedDriver.price : o.price)}₸</div>
        </div>
        <div class="hist-route">${escHtml(o.from)} → ${escHtml(o.to)}</div>
        ${o.status === 'done'
          ? '<span class="hist-b hb-ok">✓ Завершена</span>'
          : '<span class="hist-b hb-cx">✗ Отменена</span>'}
      </div>`).join('');
  } catch (e) {
    list.innerHTML = '<div class="empty-st"><div class="empty-ico">⚠️</div><div class="empty-txt">Ошибка загрузки</div></div>';
  }
}

// ---- Address modal ----
function openAddrModal(target) {
  STATE.addrTarget = target;
  const titles = {
    from: 'Откуда едем?',
    to: 'Куда едем?',
    'ic-from': 'Откуда (город + адрес)',
    'ic-to': 'Куда (город + адрес)'
  };
  _setText('mo-addr-title', titles[target] || 'Адрес');

  const cur = target === 'from' ? STATE.fromAddr
    : target === 'to' ? STATE.toAddr
    : target === 'ic-from' ? STATE.icFromAddr
    : STATE.icToAddr;

  _setVal('mo-addr-input', cur ? cur.address : '');
  _setVal('mo-ent-input', cur ? cur.entrance || '' : '');

  // City field: show only for intercity
  const isIc = target === 'ic-from' || target === 'ic-to';
  const cityWrap = document.getElementById('mo-city-wrap');
  if (cityWrap) cityWrap.style.display = isIc ? '' : 'none';
  if (isIc) {
    _setVal('mo-city-input', cur ? cur.city || '' : '');
    const cityInput = document.getElementById('mo-city-input');
    const cityList = document.getElementById('mo-city-ac-list');
    if (cityInput && cityList) {
      cityInput.oninput = function() {
        const q = this.value.trim().toLowerCase();
        cityList.innerHTML = '';
        if (q.length < 2) { cityList.classList.remove('open'); return; }
        const matches = [];
        (window.COUNTRIES || []).forEach(c => {
          (c.cities || []).forEach(city => {
            if (city.toLowerCase().includes(q)) matches.push({ city, country: c.name });
          });
        });
        if (!matches.length) { cityList.classList.remove('open'); return; }
        matches.slice(0, 8).forEach(m => {
          const li = document.createElement('div');
          li.className = 'ac-item';
          li.textContent = m.city + ', ' + m.country;
          li.onclick = () => {
            cityInput.value = m.city;
            if (STATE.addrTarget === 'ic-from') STATE.icFromCity = m.city;
            if (STATE.addrTarget === 'ic-to') STATE.icToCity = m.city;
            cityList.classList.remove('open');
          };
          cityList.appendChild(li);
        });
        cityList.classList.add('open');
      };
    }
  }

  openModal('mo-address');
  setTimeout(() => {
    const el = document.getElementById('mo-addr-input');
    if (el) el.focus();
  }, 350);
}

function saveAddr() {
  const addr = document.getElementById('mo-addr-input').value.trim();
  const entrance = document.getElementById('mo-ent-input').value.trim();
  const isIc = STATE.addrTarget === 'ic-from' || STATE.addrTarget === 'ic-to';
  const cityEl = document.getElementById('mo-city-input');
  const city = isIc && cityEl ? cityEl.value.trim() : '';
  if (isIc) {
    if (STATE.addrTarget === 'ic-from') STATE.icFromCity = city;
    if (STATE.addrTarget === 'ic-to') STATE.icToCity = city;
  }

  if (!addr) { showToast('Введите адрес', 'err'); return; }
  if (isIc && !city) { showToast('Укажите город', 'err'); return; }

  const data = { address: isIc ? `${city}, ${addr}` : addr, entrance, city };
  const t = STATE.addrTarget;

  if (t === 'from') {
    STATE.fromAddr = data;
    const el = document.getElementById('p-from-txt');
    if (el) el.innerHTML = escHtml(addr);
    _setText('p-from-ent', entrance ? 'Подъезд ' + entrance : '');
  } else if (t === 'to') {
    STATE.toAddr = data;
    const el = document.getElementById('p-to-txt');
    if (el) el.innerHTML = escHtml(addr);
    _setText('p-to-ent', entrance ? 'Подъезд ' + entrance : '');
  } else if (t === 'ic-from') {
    STATE.icFromAddr = data;
    _setText('ic-from-txt', data.address);
  } else if (t === 'ic-to') {
    STATE.icToAddr = data;
    _setText('ic-to-txt', data.address);
  }
  closeModal('mo-address');
}

// ---- Chips ----
function chPax(d) {
  STATE.pax = Math.max(1, Math.min(8, STATE.pax + d));
  _setText('mo-pax-num', STATE.pax);
}
function savePax() {
  _setText('chip-pax-lbl', `${STATE.pax} пасс.`);
  closeModal('mo-pax');
}
function toggleChip(name) {
  if (name === 'child') {
    STATE.childSeat = !STATE.childSeat;
    const el = document.getElementById('chip-child');
    if (el) el.classList.toggle('on', STATE.childSeat);
  }
}
function selPay(m) {
  STATE.payMethod = m;
  const cc = document.getElementById('pay-cash-check');
  const tc = document.getElementById('pay-transfer-check');
  if (cc) cc.style.color = m === 'cash' ? 'var(--y)' : 'var(--text3)';
  if (tc) tc.style.color = m === 'transfer' ? 'var(--y)' : 'var(--text3)';
  _setText('chip-pay-lbl', m === 'cash' ? 'Наличные' : 'Перевод');
}

// ---- XSS protection ----
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

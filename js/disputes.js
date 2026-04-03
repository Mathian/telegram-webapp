/* ============================================================
   DISPUTES — Cancellation handling, response notifications,
              dispute creation, auto-blocking system
   ============================================================ */

const AUTO_BLOCK_THRESHOLD = 3;
const AUTO_BLOCK_MS = 24 * 3600 * 1000; // 24 hours

// Defaults — overridden by admin settings loaded in loadAppSettings()
let PASSENGER_CANCEL_PENALTY = 0.1;
let DRIVER_CANCEL_PENALTY    = 0.05;

// ---- Response modal state ----
let _rn_timer  = null;
let _rn_notif  = null;

// ---- Notification listener (persistent) ----
let _unsubNotifListener = null;

// ===========================================================
// PENALTY & DAILY STATS
// ===========================================================

/** Subtract rating directly (penalty, not weighted average) */
async function applyRatingPenalty(uid, amount) {
  try {
    const user = await dbGet('users', uid);
    if (!user) return;
    const newRating = Math.max(1.0, Math.round(((user.rating || 5.0) - amount) * 100) / 100);
    await dbSet('users', uid, { rating: newRating });
    if (uid === STATE.uid) {
      STATE.user.rating = newRating;
      saveState();
      updateAllUI && updateAllUI();
    }
  } catch (e) { console.warn('[penalty]', e); }
}

/** Increment daily cancellation counter for a user */
async function recordDailyCancel(uid) {
  const today = new Date().toDateString();
  try {
    const user = await dbGet('users', uid);
    const same  = user?.lastCancelDate === today;
    const count = (same ? (user?.cancellationsToday || 0) : 0) + 1;
    await dbSet('users', uid, { cancellationsToday: count, lastCancelDate: today });
    if (uid === STATE.uid) {
      STATE.user.cancellationsToday = count;
      STATE.user.lastCancelDate = today;
      saveState();
    }
    return count;
  } catch (e) { return 1; }
}

/** Increment disputesToday for a user (called when dispute is created) */
async function recordDailyDispute(uid) {
  const today = new Date().toDateString();
  try {
    const user  = await dbGet('users', uid);
    const same  = user?.lastDisputeDate === today;
    const count = (same ? (user?.disputesToday || 0) : 0) + 1;
    await dbSet('users', uid, { disputesToday: count, lastDisputeDate: today });
    if (uid === STATE.uid) {
      STATE.user.disputesToday = count;
      STATE.user.lastDisputeDate = today;
      saveState();
    }
  } catch (e) {}
}

// ===========================================================
// AUTO-BLOCK
// ===========================================================

/** Check if user should be temp-blocked; if yes — block + notify */
async function checkAutoBlock(uid, role) {
  try {
    const today = new Date().toDateString();
    const user  = await dbGet('users', uid);
    if (!user || user.blocked) return; // permanent block takes priority

    const cancels  = (user.lastCancelDate  === today ? (user.cancellationsToday || 0) : 0);
    const disputes = (user.lastDisputeDate === today ? (user.disputesToday      || 0) : 0);

    if (cancels + disputes >= AUTO_BLOCK_THRESHOLD) {
      const until = new Date(Date.now() + AUTO_BLOCK_MS).toISOString();
      await dbSet('users', uid, {
        tempBlocked:     true,
        tempBlockedUntil: until,
        tempBlockCount:  (user.tempBlockCount || 0) + 1
      });

      if (uid === STATE.uid) {
        STATE.user.tempBlocked      = true;
        STATE.user.tempBlockedUntil = until;
        saveState();
        // Driver: end shift first
        if (role === 'driver' && typeof endShift === 'function') {
          try { await endShift(); } catch (_) {}
        }
        _showBlockedScreen(until);
      }
    }
  } catch (e) { console.warn('[autoBlock]', e); }
}

function _showBlockedScreen(until) {
  const dateStr = until
    ? new Date(until).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
    : '';
  _setText('s-blocked-until', dateStr ? `до ${dateStr}` : '');
  showScreen('s-blocked');
}

// ===========================================================
// DISPUTES
// ===========================================================

/**
 * Create a dispute document.
 * @param {string} type       'driver_late' | 'no_passenger'
 * @param {string} orderId
 * @param {string} driverUid
 * @param {string} passengerId
 * @param {object|null} driverGeo   {lat, lng}
 * @param {object|null} passengerGeo {lat, lng}
 * @returns {string|null} disputeId
 */
async function createDispute(type, orderId, driverUid, passengerId, driverGeo, passengerGeo) {
  try {
    const order = await dbGet('orders', orderId);
    const [pUser, dUser] = await Promise.all([
      dbGet('users', passengerId),
      dbGet('users', driverUid)
    ]);

    const today = new Date().toDateString();
    const disputeId = 'DISP-' + Date.now();

    await dbSet('disputes', disputeId, {
      id:           disputeId,
      type,
      orderId,
      passengerId,
      driverUid,
      passengerName:  pUser?.name  || '—',
      driverName:     dUser?.name  || '—',
      passengerPhone: pUser?.phone || '—',
      driverPhone:    dUser?.phone || '—',
      from:           order?.from  || '—',
      to:             order?.to    || '—',
      driverGeo:    driverGeo    || null,
      passengerGeo: passengerGeo || null,
      passengerDisputesWon:  pUser?.disputesWon  || 0,
      passengerDisputesLost: pUser?.disputesLost || 0,
      driverDisputesWon:     dUser?.disputesWon  || 0,
      driverDisputesLost:    dUser?.disputesLost || 0,
      status:     'pending',
      resolution: null,
      createdAt:  new Date().toISOString(),
      resolvedAt: null,
    });

    // Increment disputesToday for both participants
    await recordDailyDispute(passengerId);
    await recordDailyDispute(driverUid);

    return disputeId;
  } catch (e) {
    console.warn('[createDispute]', e);
    return null;
  }
}

// ===========================================================
// NOTIFICATIONS
// ===========================================================

/** Write a pending notification for a user */
async function sendNotification(toUid, notifData) {
  await dbSet('notifications', toUid + '_pending', {
    ...notifData,
    status:    'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 11000).toISOString(), // 11s — slightly > 10s UI timer
  });
}

// ===========================================================
// RESPONSE MODAL (10-second countdown)
// ===========================================================

const _RN_TITLES = {
  driver_late_q:  '⚠️ Пассажир не дождался',
  no_passenger_q: '⚠️ Водитель не нашёл вас',
};
const _RN_MESSAGES = {
  driver_late_q:  'Пассажир отменил заказ, указав что вы не прибыли вовремя. Ваш ответ:',
  no_passenger_q: 'Водитель отменил заказ, указав что вас не было на месте. Ваш ответ:',
};
const _RN_BUTTONS = {
  driver_late_q: [
    { key: 'not_on_time',     label: '⏰ Я не успел',       cls: 'btn-out' },
    { key: 'decided_not_to',  label: '🚫 Я решил не ехать', cls: 'btn-out' },
    { key: 'i_arrived',       label: '📍 Я приехал',        cls: 'btn-y'   },
  ],
  no_passenger_q: [
    { key: 'not_on_time',     label: '⏰ Я не успел',        cls: 'btn-out' },
    { key: 'decided_not_to',  label: '🚫 Я решил не ехать',  cls: 'btn-out' },
    { key: 'i_was_there',     label: '📍 Я был на месте',    cls: 'btn-y'   },
  ],
};

function showResponseModal(notif) {
  _rn_notif = notif;

  _setText('rn-title',   _RN_TITLES[notif.type]   || 'Уведомление');
  _setText('rn-message', _RN_MESSAGES[notif.type] || '');

  const btns = document.getElementById('rn-buttons');
  if (btns) {
    btns.innerHTML = (_RN_BUTTONS[notif.type] || []).map(b =>
      `<button class="btn ${b.cls}" onclick="submitNotifResponse('${b.key}')">${b.label}</button>`
    ).join('');
  }

  // Countdown
  const bar    = document.getElementById('rn-timer-bar');
  const secEl  = document.getElementById('rn-seconds');
  const start  = Date.now();
  const TTL    = 10000;
  if (bar)   bar.style.width   = '100%';
  if (secEl) secEl.textContent = '10';

  clearInterval(_rn_timer);
  _rn_timer = setInterval(() => {
    const rem = Math.max(0, TTL - (Date.now() - start));
    if (bar)   bar.style.width   = (rem / TTL * 100).toFixed(1) + '%';
    if (secEl) secEl.textContent = Math.ceil(rem / 1000);
    if (rem <= 0) {
      clearInterval(_rn_timer); _rn_timer = null;
      closeModal('mo-response-notif');
      // Modal closed by timeout — sender-side timer handles the penalty
    }
  }, 200);

  openModal('mo-response-notif');
  tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('warning');
}

/** Called when user taps one of the response buttons */
async function submitNotifResponse(responseKey) {
  clearInterval(_rn_timer); _rn_timer = null;
  closeModal('mo-response-notif');
  if (!_rn_notif) return;
  const notif = _rn_notif;
  _rn_notif = null;

  // Mark as responded so sender-side timer doesn't also apply penalty
  try {
    await dbSet('notifications', STATE.uid + '_pending', { status: 'responded', response: responseKey });
  } catch (_) {}

  if (notif.type === 'driver_late_q') {
    await _handleDriverLateResponse(responseKey, notif);
  } else if (notif.type === 'no_passenger_q') {
    await _handleNoPassengerResponse(responseKey, notif);
  }
}

// Driver responds to "driver not arrived" complaint
async function _handleDriverLateResponse(key, notif) {
  const penalty = window._appSettings?.driverCancelPenalty ?? DRIVER_CANCEL_PENALTY;
  if (key === 'not_on_time' || key === 'decided_not_to') {
    await applyRatingPenalty(STATE.uid, penalty);
    await recordDailyCancel(STATE.uid);
    await checkAutoBlock(STATE.uid, 'driver');
    showToast('Ваш рейтинг снижен', 'warn');
  } else if (key === 'i_arrived') {
    const geo = await _getCurrentGeo();
    const id  = await createDispute(
      'driver_late', notif.orderId,
      STATE.uid,           // driverUid
      notif.passengerId,   // passengerId
      geo, null
    );
    if (id) showToast('Диспут открыт. Администратор рассмотрит ситуацию.', 'ok');
  }
}

// Passenger responds to "no passenger found" complaint
async function _handleNoPassengerResponse(key, notif) {
  const penalty = window._appSettings?.passengerCancelPenalty ?? PASSENGER_CANCEL_PENALTY;
  if (key === 'not_on_time' || key === 'decided_not_to') {
    await applyRatingPenalty(STATE.uid, penalty);
    await recordDailyCancel(STATE.uid);
    await checkAutoBlock(STATE.uid, 'passenger');
    showToast('Ваш рейтинг снижен', 'warn');
  } else if (key === 'i_was_there') {
    const geo = await _getCurrentGeo();
    const id  = await createDispute(
      'no_passenger', notif.orderId,
      notif.driverUid,     // driverUid
      STATE.uid,           // passengerId
      notif.driverGeo,     // driver's geo captured at cancel time
      geo                  // passenger's current geo
    );
    if (id) showToast('Диспут открыт. Администратор рассмотрит ситуацию.', 'ok');
  }
}

// ===========================================================
// NOTIFICATION LISTENER (called once from initMain)
// ===========================================================

function setupNotificationListener() {
  if (_unsubNotifListener) { _unsubNotifListener(); _unsubNotifListener = null; }
  if (!STATE.uid) return;

  _unsubNotifListener = onDocSnapshot('notifications', STATE.uid + '_pending', notif => {
    if (!notif || notif.status !== 'pending') return;

    // Ignore if already expired by time
    if (notif.expiresAt && new Date(notif.expiresAt) < new Date()) {
      dbSet('notifications', STATE.uid + '_pending', { status: 'expired' }).catch(() => {});
      return;
    }

    switch (notif.type) {
      case 'driver_late_q':
      case 'no_passenger_q':
        showResponseModal(notif);
        break;

      case 'driver_cancelled_info':
        showToast(notif.message || 'Водитель отменил заказ. Создайте заявку заново.', 'warn');
        tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('warning');
        // Return passenger to new-order screen if still on active ride
        if (STATE.activeOrderId && notif.orderId === STATE.activeOrderId) {
          STATE.activeOrderId = null;
          STATE.arrivalAcknowledged = false;
          saveState();
          if (typeof _unsubPassengerOrder !== 'undefined' && _unsubPassengerOrder) {
            _unsubPassengerOrder(); _unsubPassengerOrder = null;
          }
          if (typeof stopArrivalSound === 'function') stopArrivalSound();
          if (typeof stopGeoTransmit  === 'function') stopGeoTransmit();
          _show('p-active-ride', false);
          _show('p-new-order', true);
        }
        dbSet('notifications', STATE.uid + '_pending', { status: 'seen' }).catch(() => {});
        break;

      case 'dispute_result':
        showToast(notif.message || 'Диспут рассмотрен', notif.msgType || 'ok');
        tg.HapticFeedback && tg.HapticFeedback.notificationOccurred(notif.msgType === 'warn' ? 'warning' : 'success');
        dbSet('notifications', STATE.uid + '_pending', { status: 'seen' }).catch(() => {});
        break;
    }
  });
}

// ===========================================================
// HELPERS
// ===========================================================

/** Try to get current GPS position; resolves null on failure */
function _getCurrentGeo() {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      ()  => resolve(null),
      { timeout: 3000, maximumAge: 15000 }
    );
  });
}

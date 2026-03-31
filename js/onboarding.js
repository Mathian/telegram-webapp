/* ============================================================
   ONBOARDING — Registration flow
   Fixes:
     - DOB field removed
     - Phone auto-filled from Telegram (readonly)
     - Phone fetched from Firebase phone_shares if available
   ============================================================ */

// Pre-fill registration form from Telegram data
async function prefillTg() {
  const u = tg.initDataUnsafe && tg.initDataUnsafe.user;
  const nameEl = document.getElementById('reg-name');
  const phoneEl = document.getElementById('reg-phone');

  // Fill name
  if (u && u.first_name && nameEl) {
    nameEl.value = u.first_name + (u.last_name ? ' ' + u.last_name : '');
  }

  // Try to get phone from Firebase (stored by bot when user shared contact)
  if (u && u.id) {
    const tgId = String(u.id);
    try {
      const phoneData = await dbGet('phone_shares', tgId);
      if (phoneData && phoneData.phone && phoneEl) {
        phoneEl.value = phoneData.phone;
        phoneEl.readOnly = true;
        // Show lock icon
        const lockEl = document.getElementById('phone-lock-icon');
        if (lockEl) lockEl.style.display = '';
      }
    } catch (e) {}
  }
}

// ---- Role selection (step 1) ----
function selRole(r) {
  STATE.obRole = r;
  document.querySelectorAll('.role-card').forEach(c =>
    c.classList.toggle('sel', c.dataset.role === r)
  );
}

// ---- Step navigation ----
function obNext(step) {
  if (step === 1) {
    if (!STATE.obRole) { showToast('Выберите роль', 'err'); return; }
    setObStep(2);
  } else if (step === 2) {
    const name = document.getElementById('reg-name').value.trim();
    const phone = document.getElementById('reg-phone').value.trim();
    const country = document.getElementById('reg-country').value;
    const city = document.getElementById('reg-city').value;

    if (!name) { showToast('Введите имя', 'err'); return; }
    if (!phone || phone.length < 6) { showToast('Введите телефон', 'err'); return; }
    if (!country) { showToast('Выберите страну из списка', 'err'); return; }
    if (!city) { showToast('Выберите город из списка', 'err'); return; }

    setObStep(3);
    _show('ob-driver-block', STATE.obRole === 'driver');
    _show('ob-passenger-block', STATE.obRole !== 'driver');
  }
}

function obBack(step) { setObStep(step - 1); }

function setObStep(n) {
  document.querySelectorAll('.ob-step').forEach((s, i) =>
    s.classList.toggle('active', i + 1 === n)
  );
  [1, 2, 3].forEach(i =>
    document.getElementById('sd' + i).classList.toggle('active', i <= n)
  );
}

// ---- Complete registration ----
async function finishReg() {
  const btn = document.getElementById('btn-finish-reg');
  const name = document.getElementById('reg-name').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  const country = document.getElementById('reg-country').value;
  const countryName = document.getElementById('reg-country-input').value.trim();
  const city = document.getElementById('reg-city').value || document.getElementById('reg-city-input').value.trim();

  if (!name) { showToast('Введите имя', 'err'); return; }
  if (!phone) { showToast('Введите телефон', 'err'); return; }
  if (!city) { showToast('Выберите город', 'err'); return; }

  if (STATE.obRole === 'driver') {
    const brand = document.getElementById('reg-car-brand').value.trim();
    const num = document.getElementById('reg-car-num').value.trim();
    const color = document.getElementById('reg-car-color').value.trim();
    const year = document.getElementById('reg-car-year').value;
    if (!brand || !num || !color) { showToast('Заполните данные авто', 'err'); return; }
    if (!year || parseInt(year) < 1990) { showToast('Укажите корректный год', 'err'); return; }
  }

  btn.disabled = true;
  btn.textContent = 'Сохранение...';
  showLoading(true);

  try {
    const tgUser = tg.initDataUnsafe && tg.initDataUnsafe.user;
    const tgId = (tgUser && tgUser.id) ? String(tgUser.id) : 'local_' + Date.now();

    const user = {
      tgId,
      name,
      phone,
      country,
      countryName,
      city,
      username: (tgUser && tgUser.username) || '',
      role: STATE.obRole,
      rating: 5.0,
      ratingCount: 0,
      trips: 0,
      passengerTrips: 0,
      driverTrips: 0,
      createdAt: new Date().toISOString(),
      approved: STATE.obRole === 'passenger',
      freeUntil: new Date(Date.now() + FREE_MONTHS * 30 * 24 * 3600 * 1000).toISOString(),
      bonusTrips: 0,
      totalShifts: 0,
      avgShiftTrips: 0,
      blocked: false,
    };

    if (STATE.obRole === 'driver') {
      user.car = {
        brand: document.getElementById('reg-car-brand').value.trim(),
        num: document.getElementById('reg-car-num').value.trim().toUpperCase(),
        color: document.getElementById('reg-car-color').value.trim(),
        year: document.getElementById('reg-car-year').value,
      };
      user.approved = false;
      user.driverMode = 'city';
    }

    STATE.user = user;
    STATE.role = STATE.obRole;
    STATE.registered = true;
    saveState();

    // Save to Firebase
    await dbSet('users', tgId, user);

    showLoading(false);
    showToast('Регистрация завершена! ✅', 'ok');
    setTimeout(() => initMain(), 600);
  } catch (e) {
    console.error('finishReg error:', e);
    showLoading(false);
    btn.disabled = false;
    btn.textContent = 'Начать 🚀';
    showToast('Ошибка. Попробуйте ещё раз', 'err');
  }
}

// ---- Become driver from settings (passenger → driver) ----
async function becomeDriver() {
  const brand = document.getElementById('set-car-brand').value.trim();
  const year = parseInt(document.getElementById('set-car-year').value);
  const num = document.getElementById('set-car-num').value.trim().toUpperCase();
  const color = document.getElementById('set-car-color').value.trim();
  if (!brand || !num || !color || !year) {
    showToast('Заполните все данные автомобиля!', 'err'); return;
  }
  showLoading(true);
  try {
    const updates = {
      role: 'driver',
      car: { brand, year, num, color },
      approved: false,
      appliedForDriverAt: new Date().toISOString(),
      freeUntil: new Date(Date.now() + FREE_MONTHS * 30 * 24 * 3600 * 1000).toISOString()
    };
    await dbSet('users', STATE.user.tgId, updates);
    STATE.user = { ...STATE.user, ...updates };
    saveState();
    closeModal('mo-settings');
    showToast('✅ Заявка на водителя отправлена! Ожидайте проверки.', 'ok');
    updateAllUI();
  } catch (e) {
    showToast('Ошибка при отправке заявки', 'err');
    console.error(e);
  }
  showLoading(false);
}

// ---- Switch between passenger/driver roles ----
function switchRole() {
  const newRole = STATE.role === 'passenger' ? 'driver' : 'passenger';
  tg.showConfirm(
    `Переключиться на ${newRole === 'driver' ? 'водителя' : 'пассажира'}?`,
    async (ok) => {
      if (!ok) return;
      if (newRole === 'driver') {
        if (!STATE.user.car) {
          showToast('Для водителя нужно заполнить данные авто', 'warn');
          openModal('mo-settings');
          return;
        }
        if (STATE.user.blocked) {
          showToast('Ваш аккаунт заблокирован', 'err');
          return;
        }
      }
      // Stop any active listeners before switching
      if (typeof stopListeningOrders === 'function') stopListeningOrders();
      if (typeof stopGeoTransmit === 'function') stopGeoTransmit();

      STATE.role = newRole;
      if (STATE.user) STATE.user.role = newRole;
      saveState();

      if (newRole === 'passenger') {
        showScreen('s-passenger');
        setupPassengerListeners();
      } else {
        showScreen('s-driver');
        setupDriverListeners();
      }
      updateAllUI();
      showToast('Режим переключён', 'ok');
    }
  );
}

// ---- Save settings ----
async function saveSettings() {
  const name = document.getElementById('set-name').value.trim();
  const country = document.getElementById('set-country').value;
  const countryName = document.getElementById('set-country-input').value.trim();
  const city = document.getElementById('set-city').value || document.getElementById('set-city-input').value.trim();

  if (!name) { showToast('Введите имя', 'err'); return; }
  if (!city) { showToast('Выберите город', 'err'); return; }

  const updates = { name, country, countryName, city };

  if (STATE.user.role === 'driver') {
    const brand = document.getElementById('edit-car-brand').value.trim();
    const year = document.getElementById('edit-car-year').value;
    const num = document.getElementById('edit-car-num').value.trim().toUpperCase();
    const color = document.getElementById('edit-car-color').value.trim();
    if (brand && num && color) {
      const newCar = { brand, num, color, year };
      if (JSON.stringify(newCar) !== JSON.stringify(STATE.user.car || {})) {
        updates.car = newCar;
        updates.approved = false;
        showToast('Данные авто изменены. Ожидайте подтверждения.', 'warn');
      }
    }
  }

  STATE.user = { ...STATE.user, ...updates };
  saveState();
  try { await dbSet('users', STATE.user.tgId, updates); } catch (e) {}
  updateAllUI();
  updateDriverUI();
  closeModal('mo-settings');
  showToast('Сохранено ✅', 'ok');
}

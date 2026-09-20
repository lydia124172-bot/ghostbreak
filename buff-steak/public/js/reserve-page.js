const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

const params = new URLSearchParams(location.search);
const locParam = params.get('location');
if (locParam && document.getElementById('locationId')) {
  document.getElementById('locationId').value = locParam;
}

const dateInput = document.getElementById('date');
const timeInput = document.getElementById('time');
const locationSelect = document.getElementById('locationId');
const guestsInput = document.getElementById('guests');
const capacityHint = document.getElementById('capacityHint');
const restHint = document.getElementById('restHint');
const submitBtn = document.getElementById('submitBtn');
const onlineFullHint = document.getElementById('onlineFullHint');
const depositHint = document.getElementById('depositHint');
const calendarGrid = document.getElementById('calendarGrid');
const calMonthLabel = document.getElementById('calMonth');
const slotBoard = document.getElementById('slotBoard');

let siteConfig = null;
let daySlots = [];
let dayClosed = false;
let onlineFull = false;
let viewYear;
let viewMonth;
{
  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();
}

function ymd(dt) {
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${m}-${d}`;
}

function todayYmd() {
  return ymd(new Date());
}

function getLocationConfig(locationId) {
  return siteConfig?.locations?.find((l) => l.id === locationId);
}

function getSchedule() {
  return siteConfig?.schedule || { extraClosed: {}, extraOpen: {}, closedSlots: {}, notes: {} };
}

function dayStatus(locationId, dateStr) {
  const loc = getLocationConfig(locationId);
  if (!loc || !dateStr) return { closed: false, kind: 'none' };
  const schedule = getSchedule();
  if ((schedule.extraClosed[locationId] || []).includes(dateStr)) {
    return { closed: true, kind: 'temp-closed', note: schedule.notes?.[locationId]?.[dateStr] || '臨時公休' };
  }
  if ((schedule.extraOpen[locationId] || []).includes(dateStr)) {
    return { closed: false, kind: 'temp-open', note: schedule.notes?.[locationId]?.[dateStr] || '臨時營業' };
  }
  const weekday = new Date(`${dateStr}T12:00:00`).getDay();
  if ((loc.closedWeekdays || []).includes(weekday)) {
    return { closed: true, kind: 'weekly', note: '公休' };
  }
  return { closed: false, kind: 'open' };
}

function updateDepositHint() {
  const n = Number(guestsInput.value);
  const loc = getLocationConfig(locationSelect.value);
  if (n >= 10) {
    const phone = loc ? `（${loc.name} ${loc.phone}）` : '';
    depositHint.textContent = `10 人以上不接受線上訂位，請致電分店${phone}，並於用餐前 1 天至分店預付訂金。`;
    depositHint.classList.remove('hidden');
    submitBtn.disabled = true;
    return;
  }
  depositHint.classList.add('hidden');
  depositHint.textContent = '';
}

function applyOnlineFullState(full, loc) {
  onlineFull = Boolean(full);
  if (!onlineFull || !loc) {
    onlineFullHint.classList.add('hidden');
    onlineFullHint.textContent = '';
    return;
  }
  onlineFullHint.textContent = loc.onlineFullMessage || `線上訂位已滿，請致電各店詢問現場保留位（${loc.name} ${loc.phone}）`;
  onlineFullHint.classList.remove('hidden');
  submitBtn.disabled = true;
  slotBoard.innerHTML = '<p class="slot-placeholder">線上訂位已滿，請致電分店</p>';
}

function updateRestHint() {
  const loc = getLocationConfig(locationSelect.value);
  if (!loc) {
    restHint.classList.add('hidden');
    restHint.textContent = '';
    applyOnlineFullState(false, null);
    return;
  }
  const note = loc.hours?.find((h) => String(h).includes('公休')) || '';
  restHint.textContent = note ? `※ 固定公休：${note}` : '';
  restHint.classList.toggle('hidden', !note);
  applyOnlineFullState(loc.onlineFull, loc);
}

function groupSlots(slots) {
  const lunch = slots.filter((t) => Number(String(t).split(':')[0]) < 15);
  const dinner = slots.filter((t) => Number(String(t).split(':')[0]) >= 15);
  const groups = [];
  if (lunch.length) groups.push({ label: '中午時段', slots: lunch });
  if (dinner.length) groups.push({ label: '晚上時段', slots: dinner });
  return groups;
}

function renderCalendar() {
  if (!calendarGrid || !calMonthLabel) return;
  calMonthLabel.textContent = `${viewYear}年${viewMonth + 1}月`;
  const locationId = locationSelect.value;
  const selected = dateInput.value;
  const first = new Date(viewYear, viewMonth, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const today = todayYmd();
  const cells = [];

  const weekEl = document.getElementById('calWeekdays');
  if (weekEl) weekEl.innerHTML = WEEKDAYS.map((w) => `<span>${w}</span>`).join('');

  for (let i = 0; i < startWeekday; i += 1) {
    cells.push('<button type="button" class="cal-cell muted" disabled></button>');
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateStr = ymd(new Date(viewYear, viewMonth, day));
    const status = locationId ? dayStatus(locationId, dateStr) : { closed: false, kind: 'none' };
    const isPast = dateStr < today;
    const classes = ['cal-cell'];
    let label = '';
    let disabled = false;

    if (isPast) {
      classes.push('past');
      disabled = true;
    } else if (!locationId) {
      disabled = true;
    } else if (status.kind === 'weekly') {
      classes.push('closed');
      label = '公休';
      disabled = true;
    } else if (status.kind === 'temp-closed') {
      classes.push('temp-closed');
      label = '暫停';
      disabled = true;
    } else if (status.kind === 'temp-open') {
      classes.push('temp-open');
      label = '補開';
    }
    if (selected === dateStr) classes.push('selected');

    cells.push(
      `<button type="button" class="${classes.join(' ')}" data-date="${dateStr}" ${disabled ? 'disabled' : ''}>
        ${day}${label ? `<small>${label}</small>` : ''}
      </button>`
    );
  }

  calendarGrid.innerHTML = cells.join('');
}

function buildTimeOptions() {
  const locationId = locationSelect.value;
  const date = dateInput.value;
  const selectedTime = timeInput.value;

  if (!locationId || !date) {
    slotBoard.innerHTML = '<p class="slot-placeholder">請先選分店與日期</p>';
    capacityHint.classList.add('hidden');
    if (!onlineFull) submitBtn.disabled = false;
    return;
  }

  const times = daySlots.map((s) => s.time);
  if (!times.length) {
    slotBoard.innerHTML = '<p class="slot-placeholder">這天沒有可線上訂位的時段</p>';
    return;
  }

  slotBoard.innerHTML = groupSlots(times).map((group) => {
    const buttons = group.slots.map((slot) => {
      const info = daySlots.find((s) => s.time === slot);
      let extra = '';
      let disabled = false;
      if (info?.tooSoon) {
        extra = '請致電';
        disabled = true;
      } else if (info && info.remaining <= 0) {
        extra = '已滿';
        disabled = true;
      }
      const selected = selectedTime === slot ? ' selected' : '';
      return `<button type="button" class="slot-btn${selected}" data-time="${slot}" ${disabled ? 'disabled' : ''}>${slot}${extra ? `<small class="block text-[10px] opacity-80">${extra}</small>` : ''}</button>`;
    }).join('');
    return `<div class="slot-group"><p class="slot-group-label">${group.label}</p><div class="slot-board">${buttons}</div></div>`;
  }).join('');
  updateCapacityHint();
}

async function loadDaySlots() {
  const locationId = locationSelect.value;
  const date = dateInput.value;
  updateDepositHint();
  renderCalendar();
  if (!locationId || !date) {
    daySlots = [];
    buildTimeOptions();
    return;
  }
  try {
    const res = await fetch(`/api/reserve/day-availability?locationId=${encodeURIComponent(locationId)}&date=${encodeURIComponent(date)}`);
    const data = await res.json();
    daySlots = data.slots || [];
    dayClosed = Boolean(data.closed);
    const loc = getLocationConfig(locationId);
    if (data.onlineFull) {
      applyOnlineFullState(true, loc);
      capacityHint.textContent = data.onlineFullMessage || '線上訂位已滿，請致電各店詢問現場保留位';
      capacityHint.classList.remove('hidden');
      capacityHint.classList.add('capacity-hint-full');
      submitBtn.disabled = true;
      return;
    }
    applyOnlineFullState(false, loc);
    if (data.closed) {
      capacityHint.textContent = data.closedMessage || '此日公休，請選擇其他日期。';
      capacityHint.classList.remove('hidden');
      capacityHint.classList.add('capacity-hint-full');
      submitBtn.disabled = true;
      slotBoard.innerHTML = '<p class="slot-placeholder">此日公休，請改選其他日期</p>';
      timeInput.value = '';
      return;
    }
    const allTooSoon = daySlots.length > 0 && daySlots.every((s) => s.tooSoon);
    if (allTooSoon) {
      const phone = loc?.phone ? ` ${loc.phone}` : '';
      capacityHint.textContent = `今日剩餘時段已過線上訂位截止（需提前 6 小時）。因即時訂位時間不及，無法為您排位，請直接致電分店${phone}。`;
      capacityHint.classList.remove('hidden');
      capacityHint.classList.add('capacity-hint-full');
      submitBtn.disabled = true;
    } else {
      capacityHint.classList.add('hidden');
      capacityHint.classList.remove('capacity-hint-full');
      submitBtn.disabled = false;
    }
    dayClosed = false;
  } catch {
    daySlots = [];
  }
  buildTimeOptions();
}

function selectDate(dateStr) {
  dateInput.value = dateStr;
  timeInput.value = '';
  loadDaySlots();
}

function selectTime(time) {
  timeInput.value = time;
  buildTimeOptions();
}

async function updateCapacityHint() {
  const locationId = locationSelect.value;
  const date = dateInput.value;
  const time = timeInput.value;
  capacityHint.classList.remove('capacity-hint-full');

  if (onlineFull) {
    submitBtn.disabled = true;
    if (!locationId || !date || !time) return;
  }

  if (!locationId || !date || !time) {
    if (!dayClosed) capacityHint.classList.add('hidden');
    guestsInput.max = 9;
    if (!onlineFull && !dayClosed) submitBtn.disabled = false;
    return;
  }

  try {
    const res = await fetch(`/api/reserve/availability?locationId=${encodeURIComponent(locationId)}&date=${encodeURIComponent(date)}&time=${encodeURIComponent(time)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '無法查詢剩餘座位');

    if (data.onlineFull) {
      const loc = getLocationConfig(locationId);
      applyOnlineFullState(true, loc);
      capacityHint.textContent = data.onlineFullMessage || '線上訂位已滿，請致電各店詢問現場保留位';
      capacityHint.classList.remove('hidden');
      capacityHint.classList.add('capacity-hint-full');
      submitBtn.disabled = true;
      return;
    }

    if (data.tooSoon) {
      capacityHint.textContent = data.tooSoonMessage || '線上訂位需至少提前 6 小時，因即時訂位時間不及，無法為您排位，請直接致電分店。';
      capacityHint.classList.remove('hidden');
      capacityHint.classList.add('capacity-hint-full');
      guestsInput.max = 1;
      submitBtn.disabled = true;
      return;
    }

    if (data.closed || data.remaining <= 0) {
      capacityHint.textContent = data.closedMessage || '此訂位時段已滿，請選擇其他時段，或直接致電分店訂位。';
      capacityHint.classList.remove('hidden');
      capacityHint.classList.add('capacity-hint-full');
      guestsInput.max = 1;
      submitBtn.disabled = true;
      return;
    }

    const maxOnline = 9;
    const maxGuests = Math.min(maxOnline, data.remaining);
    guestsInput.max = maxGuests;
    if (Number(guestsInput.value) > maxGuests) guestsInput.value = maxGuests;
    capacityHint.textContent = data.diningLabel || '';
    capacityHint.classList.toggle('hidden', !data.diningLabel);
    submitBtn.disabled = false;
  } catch (err) {
    capacityHint.textContent = err.message;
    capacityHint.classList.remove('hidden');
    submitBtn.disabled = false;
  }
}

fetch('/api/config').then((r) => r.json()).then((config) => {
  siteConfig = config;
  updateRestHint();
  renderCalendar();
  loadDaySlots();
}).catch(() => renderCalendar());

locationSelect.addEventListener('change', async () => {
  try {
    siteConfig = await fetch('/api/config').then((r) => r.json());
  } catch {}
  dateInput.value = '';
  timeInput.value = '';
  updateRestHint();
  renderCalendar();
  loadDaySlots();
});

document.getElementById('calPrev')?.addEventListener('click', () => {
  viewMonth -= 1;
  if (viewMonth < 0) {
    viewMonth = 11;
    viewYear -= 1;
  }
  renderCalendar();
});

document.getElementById('calNext')?.addEventListener('click', () => {
  viewMonth += 1;
  if (viewMonth > 11) {
    viewMonth = 0;
    viewYear += 1;
  }
  renderCalendar();
});

calendarGrid?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-date]');
  if (!btn || btn.disabled) return;
  selectDate(btn.getAttribute('data-date'));
});

slotBoard?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-time]');
  if (!btn || btn.disabled) return;
  selectTime(btn.getAttribute('data-time'));
});

guestsInput.addEventListener('change', () => {
  updateDepositHint();
  updateCapacityHint();
});
guestsInput.addEventListener('input', updateDepositHint);

document.getElementById('reserveForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const locationId = locationSelect.value;
  const date = dateInput.value;
  if (!date) {
    showToast('請在時間表上選擇日期', false);
    return;
  }
  if (!timeInput.value) {
    showToast('請選擇用餐時段', false);
    return;
  }
  if (Number(guestsInput.value) >= 10) {
    const loc = getLocationConfig(locationId);
    showToast(`10 人以上不接受線上訂位，請致電${loc ? loc.name + ' ' + loc.phone : '分店'}。`, false);
    return;
  }
  if (onlineFull) {
    const loc = getLocationConfig(locationId);
    showToast(loc?.onlineFullMessage || '線上訂位已滿，請致電各店詢問現場保留位', false);
    return;
  }
  const status = dayStatus(locationId, date);
  if (status.closed || dayClosed) {
    showToast(status.note === '公休' ? '此日為固定公休，無法訂位。' : '此日暫停線上訂位，請選擇其他日期。', false);
    return;
  }
  const selectedSlot = daySlots.find((s) => s.time === timeInput.value);
  if (selectedSlot?.tooSoon) {
    const loc = getLocationConfig(locationId);
    showToast(selectedSlot.tooSoonMessage || `線上訂位需至少提前 6 小時，因即時訂位時間不及，無法為您排位。請直接致電分店${loc?.phone ? ` ${loc.phone}` : ''}。`, false);
    return;
  }
  submitBtn.disabled = true;
  submitBtn.textContent = '送出中…';
  try {
    const data = await postJson('/api/reserve', {
      locationId: locationSelect.value,
      date: dateInput.value,
      time: timeInput.value,
      guests: guestsInput.value,
      name: document.getElementById('name').value,
      phone: document.getElementById('phone').value,
      email: document.getElementById('email').value,
      notes: document.getElementById('notes').value,
    });
    document.getElementById('reserveForm').classList.add('hidden');
    document.getElementById('successBox').classList.remove('hidden');
    document.getElementById('successMsg').textContent = (data.message || '訂位成功') + (data.id ? `（單號 ${data.id}）` : '');
    const r = data.reservation;
    const details = document.getElementById('successDetails');
    if (r) {
      details.innerHTML = [
        `分店：${r.locationName || ''}`,
        `日期：${r.dateLabel || r.date || ''}`,
        `時間：${r.time || ''}`,
        `人數：${r.guests || ''} 人`,
        r.id ? `單號：${r.id}` : '',
      ].filter(Boolean).map((line) => `<p>${line}</p>`).join('');
      details.classList.remove('hidden');
    }
    document.getElementById('confirmHint').textContent = data.guestConfirmation?.email
      ? '訂位確認信已寄至您的 Email。'
      : '未填 Email，不會寄出確認信。';
    trackEvent('reserve_submit', {
      location_id: locationSelect.value,
      reservation_id: data.id || '',
    });
  } catch (err) {
    showToast(err.message, false);
    if (err.message.includes('已滿') || err.message.includes('僅剩') || err.message.includes('公休') || err.message.includes('提前') || err.message.includes('暫停')) {
      loadDaySlots();
    }
    submitBtn.disabled = false;
    submitBtn.textContent = '送出訂位';
  }
});

// ============================================================
// CONFIGURATION
// ============================================================
const BACKEND = 'wss://unentertaining-enduringly-jaimie.ngrok-free.dev';
const BACKEND_HTTP = BACKEND.replace('wss://', 'https://');

// ============================================================
// STATE
// ============================================================
let ws = null;
let mode = 'sms';
let timerInterval = null;
let seconds = 0;
let currentAgent = 'general';
let currentContactIndex = null;
let calendarYear = 2026;
let calendarMonth = 3; // April (0-indexed)
let calendarSelectedDate = null;
let navigationStack = [];
let callHistory = []; // for activity ledger

// ============================================================
// CONTACTS DATA
// ============================================================
const contacts = [
  // Interactable contacts (first 3)
  { name: "Gio's Restaurant", phone: "(416) 555-0142", category: "restaurant", interactable: true, initials: "GR" },
  { name: "Metro City Dental", phone: "(416) 555-0198", category: "medical", interactable: true, initials: "MD" },
  { name: "Kevin Gallagher", phone: "(647) 555-0173", category: "friend", interactable: true, initials: "KG" },
  // Non-interactable contacts
  { name: "Abrams, David", phone: "(416) 555-0101", category: "other", interactable: false, initials: "DA" },
  { name: "Baker, Michelle", phone: "(647) 555-0102", category: "other", interactable: false, initials: "MB" },
  { name: "Chen, Sarah", phone: "(416) 555-0103", category: "other", interactable: false, initials: "SC" },
  { name: "Davis, Robert", phone: "(905) 555-0104", category: "other", interactable: false, initials: "RD" },
  { name: "Evans, Jessica", phone: "(647) 555-0105", category: "other", interactable: false, initials: "JE" },
  { name: "Fisher, Mark", phone: "(416) 555-0106", category: "other", interactable: false, initials: "MF" },
  { name: "Garcia, Maria", phone: "(905) 555-0107", category: "other", interactable: false, initials: "MG" },
  { name: "Harrison, Luke", phone: "(647) 555-0108", category: "other", interactable: false, initials: "LH" },
  { name: "Ibrahim, Nadia", phone: "(416) 555-0109", category: "other", interactable: false, initials: "NI" },
  { name: "Jackson, Tyler", phone: "(905) 555-0110", category: "other", interactable: false, initials: "TJ" },
  { name: "Kim, Daniel", phone: "(647) 555-0111", category: "other", interactable: false, initials: "DK" },
  { name: "Liu, Amanda", phone: "(416) 555-0112", category: "other", interactable: false, initials: "AL" },
  { name: "Morales, Carlos", phone: "(905) 555-0113", category: "other", interactable: false, initials: "CM" },
  { name: "Nguyen, Lisa", phone: "(647) 555-0114", category: "other", interactable: false, initials: "LN" },
  { name: "O'Brien, Patrick", phone: "(416) 555-0115", category: "other", interactable: false, initials: "PO" },
  { name: "Patel, Riya", phone: "(905) 555-0116", category: "other", interactable: false, initials: "RP" },
  { name: "Quinn, Emma", phone: "(647) 555-0117", category: "other", interactable: false, initials: "EQ" },
];

// Agent mapping
const categoryToAgent = {
  friend: 'relay',
  family: 'relay',
  restaurant: 'restaurant',
  medical: 'medical',
  other: 'general'
};

const agentDisplayNames = {
  relay: 'Relay',
  restaurant: 'Concierge',
  medical: 'MedAssist',
  general: 'General'
};

const agentColors = {
  relay: 'green',
  restaurant: 'blue',
  medical: 'orange',
  general: 'gray'
};

const agentVoiceProviders = {
  relay: 'ElevenLabs',
  restaurant: 'Google Cloud TTS',
  medical: 'Kokoro (Local)',
  general: 'Kokoro (Local)'
};

// ============================================================
// SCREEN MANAGEMENT (animated)
// ============================================================
const ANIM_DURATION = 320; // ms — matches CSS animation longest timing
let isAnimating = false;

function cleanupAnimation(el) {
  el.classList.remove(
    'animating-in', 'animating-out',
    'anim-zoom-in', 'anim-zoom-out',
    'anim-fade-in', 'anim-fade-out',
    'anim-slide-in-right', 'anim-slide-out-right',
    'anim-slide-in-left', 'anim-slide-out-left'
  );
}

function show(id) {
  // Instant show — no animation (fallback / internal use)
  document.querySelectorAll('.screen').forEach(s => {
    cleanupAnimation(s);
    s.classList.remove('active');
  });
  document.getElementById(id).classList.add('active');
}

function animateTransition(fromId, toId, type) {
  if (isAnimating) return;
  if (fromId === toId) return;
  isAnimating = true;

  const fromEl = document.getElementById(fromId);
  const toEl = document.getElementById(toId);

  // Determine animation classes
  let inClass, outClass;
  if (type === 'zoom-in') {
    // Home → App: new screen zooms in, old fades out
    inClass = 'anim-zoom-in';
    outClass = 'anim-fade-out';
  } else if (type === 'zoom-out') {
    // App → Home: current screen zooms out, home fades in
    inClass = 'anim-fade-in';
    outClass = 'anim-zoom-out';
  } else if (type === 'slide-forward') {
    // Deeper into app: new page slides in from right, current slides left
    inClass = 'anim-slide-in-right';
    outClass = 'anim-slide-out-left';
  } else if (type === 'slide-back') {
    // Back within app: current slides out to right, previous slides in from left
    inClass = 'anim-slide-in-left';
    outClass = 'anim-slide-out-right';
  }

  // Set up the incoming screen
  toEl.classList.add('animating-in', inClass);

  // Set up the outgoing screen
  fromEl.classList.remove('active');
  fromEl.classList.add('animating-out', outClass);

  setTimeout(() => {
    cleanupAnimation(fromEl);
    cleanupAnimation(toEl);
    toEl.classList.add('active');
    isAnimating = false;
  }, ANIM_DURATION);
}

function navigateTo(screenId, pushToStack) {
  const current = document.querySelector('.screen.active');
  const currentId = current ? current.id : null;

  if (pushToStack !== false && currentId) {
    navigationStack.push(currentId);
  }

  if (!currentId) {
    show(screenId);
    return;
  }

  // Decide animation type
  const isFromHome = (currentId === 'home-screen');
  const animType = isFromHome ? 'zoom-in' : 'slide-forward';
  animateTransition(currentId, screenId, animType);
}

function navigateBack() {
  const prev = navigationStack.pop();
  const current = document.querySelector('.screen.active');
  const currentId = current ? current.id : null;
  const targetId = prev || 'home-screen';

  if (!currentId) {
    show(targetId);
    return;
  }

  // Decide animation type
  const isToHome = (targetId === 'home-screen');
  const animType = isToHome ? 'zoom-out' : 'slide-back';
  animateTransition(currentId, targetId, animType);
}

// ============================================================
// CLOCK
// ============================================================
function updateClock() {
  const now = new Date();
  const h = now.getHours();
  const m = String(now.getMinutes()).padStart(2, '0');
  const timeStr = (h > 12 ? h - 12 : h || 12) + ':' + m;
  const el = document.getElementById('status-time');
  if (el) el.textContent = timeStr;

  // Update calendar day on home screen
  const dayEl = document.getElementById('home-cal-day');
  if (dayEl) dayEl.textContent = now.getDate();
}
updateClock();
setInterval(updateClock, 30000);

// ============================================================
// HOME SCREEN NAVIGATION
// ============================================================
document.querySelectorAll('.app-icon').forEach(icon => {
  icon.addEventListener('click', () => {
    const app = icon.dataset.app;
    if (app === 'none') return; // Non-functional icon
    if (app === 'settings') navigateTo('settings-screen');
    if (app === 'contacts') { renderContacts(); navigateTo('contacts-screen'); }
    if (app === 'calendar') { renderCalendar(); navigateTo('calendar-screen'); }
    if (app === 'phone') navigateTo('phone-screen');
  });
});

// ============================================================
// BACK BUTTONS
// ============================================================
document.querySelectorAll('.back-btn[data-back]').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.back;
    const current = document.querySelector('.screen.active');
    const currentId = current ? current.id : null;
    navigationStack = [];
    if (!currentId) { show(target); return; }
    const isToHome = (target === 'home-screen');
    animateTransition(currentId, target, isToHome ? 'zoom-out' : 'slide-back');
  });
});

// ============================================================
// SETTINGS NAVIGATION
// ============================================================
document.querySelectorAll('.settings-item[data-nav]').forEach(item => {
  item.addEventListener('click', () => {
    const target = item.dataset.nav;
    if (target === 'none') return;
    navigateTo(target);
  });
});

// ============================================================
// AGENT DETAIL
// ============================================================
document.querySelectorAll('.agent-item[data-agent-detail]').forEach(item => {
  item.addEventListener('click', () => {
    const agentKey = item.dataset.agentDetail;
    document.getElementById('agent-detail-title').textContent = agentDisplayNames[agentKey] || 'Agent';
    document.getElementById('agent-voice-provider').textContent = agentVoiceProviders[agentKey] || 'Unknown';
    navigateTo('agent-detail-screen');
  });
});

// ============================================================
// CONTACTS
// ============================================================
function renderContacts() {
  const list = document.getElementById('contacts-list');
  list.innerHTML = '';

  // Sort contacts alphabetically
  const sorted = contacts.map((c, i) => ({ ...c, originalIndex: i }));
  sorted.sort((a, b) => {
    const nameA = a.name.replace(/[^a-zA-Z]/g, '');
    const nameB = b.name.replace(/[^a-zA-Z]/g, '');
    return nameA.localeCompare(nameB);
  });

  let lastLetter = '';
  sorted.forEach(contact => {
    const firstChar = contact.name.replace(/[^a-zA-Z]/g, '')[0].toUpperCase();
    if (firstChar !== lastLetter) {
      lastLetter = firstChar;
      const header = document.createElement('div');
      header.className = 'contact-letter-header';
      header.textContent = firstChar;
      list.appendChild(header);
    }

    const row = document.createElement('div');
    row.className = 'contact-row' + (contact.interactable ? '' : ' disabled');
    row.innerHTML = `
      <div class="contact-avatar">${contact.initials}</div>
      <span class="contact-row-name">${contact.name}</span>
    `;

    if (contact.interactable) {
      row.addEventListener('click', () => openContactDetail(contact.originalIndex));
    }

    list.appendChild(row);
  });
}

function openContactDetail(index) {
  const contact = contacts[index];
  currentContactIndex = index;

  document.getElementById('cd-name').textContent = contact.name;
  document.getElementById('cd-phone').textContent = contact.phone;
  document.getElementById('cd-phone2').textContent = contact.phone;
  document.getElementById('contact-avatar-large').textContent = contact.initials;
  document.getElementById('contact-detail-title').textContent = contact.name;

  // Set category buttons
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cat === contact.category);
  });
  updateAgentLabel(contact.category);

  // Check call history for recent call
  const recentCall = callHistory.find(h => h.contactIndex === index);
  document.getElementById('cd-recent').textContent = recentCall
    ? recentCall.date + ' via ' + agentDisplayNames[recentCall.agent]
    : 'None';

  navigateTo('contact-detail-screen');
}

// Category selector
document.querySelectorAll('.cat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const cat = btn.dataset.cat;
    if (currentContactIndex !== null) {
      contacts[currentContactIndex].category = cat;
    }
    updateAgentLabel(cat);
  });
});

function updateAgentLabel(category) {
  const agent = categoryToAgent[category] || 'general';
  document.getElementById('assigned-agent').textContent = agentDisplayNames[agent];
}

// Relay button on contact detail
document.getElementById('btn-contact-relay').addEventListener('click', () => {
  if (currentContactIndex === null) return;
  const contact = contacts[currentContactIndex];
  const agent = categoryToAgent[contact.category] || 'general';
  currentAgent = agent;

  // Pre-fill the setup screen
  document.getElementById('contact-name').value = contact.name;
  document.getElementById('task-desc').value = '';

  // Set agent badge
  const badge = document.getElementById('setup-agent-badge');
  badge.querySelector('.agent-dot').className = 'agent-dot ' + agentColors[agent];
  document.getElementById('setup-agent-name').textContent = agentDisplayNames[agent];

  navigateTo('setup-screen');
});

// Setup back button
document.getElementById('setup-back-btn').addEventListener('click', () => {
  const current = document.querySelector('.screen.active');
  const currentId = current ? current.id : null;
  if (currentContactIndex !== null) {
    if (currentId) animateTransition(currentId, 'contact-detail-screen', 'slide-back');
    else show('contact-detail-screen');
  } else {
    if (currentId) animateTransition(currentId, 'home-screen', 'zoom-out');
    else show('home-screen');
  }
});

// Non-functional contact action buttons
document.querySelectorAll('.contact-action-btn[data-action="none"]').forEach(btn => {
  btn.addEventListener('click', () => {
    // Do nothing
  });
});

// ============================================================
// CALENDAR
// ============================================================
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

async function fetchCalendarEvents() {
  try {
    const response = await fetch(BACKEND_HTTP + '/calendar');
    if (response.ok) return await response.json();
  } catch (e) {
    console.error('Calendar fetch error:', e);
  }
  return [];
}

async function renderCalendar() {
  const events = await fetchCalendarEvents();

  document.getElementById('calendar-month-title').textContent = monthNames[calendarMonth] + ' ' + calendarYear;
  document.getElementById('cal-nav-label').textContent = monthNames[calendarMonth] + ' ' + calendarYear;

  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(calendarYear, calendarMonth, 0).getDate();
  const today = new Date();

  // Previous month days
  for (let i = firstDay - 1; i >= 0; i--) {
    const cell = document.createElement('div');
    cell.className = 'cal-cell other-month';
    cell.textContent = daysInPrevMonth - i;
    grid.appendChild(cell);
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement('div');
    const dateStr = calendarYear + '-' + String(calendarMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const isToday = today.getFullYear() === calendarYear && today.getMonth() === calendarMonth && today.getDate() === d;
    const isSelected = calendarSelectedDate === dateStr;
    const hasEvents = events.some(e => e.date === dateStr);

    cell.className = 'cal-cell' + (isToday ? ' today' : '') + (isSelected ? ' selected' : '');
    cell.textContent = d;
    if (hasEvents) cell.innerHTML += '<div class="event-dot"></div>';

    cell.addEventListener('click', () => {
      calendarSelectedDate = dateStr;
      renderCalendar();
      renderCalendarEvents(events, dateStr);
    });

    grid.appendChild(cell);
  }

  // Fill remaining cells
  const totalCells = firstDay + daysInMonth;
  const remaining = (7 - (totalCells % 7)) % 7;
  for (let i = 1; i <= remaining; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-cell other-month';
    cell.textContent = i;
    grid.appendChild(cell);
  }

  // Show today's events by default or selected date
  const showDate = calendarSelectedDate || today.toISOString().split('T')[0];
  if (!calendarSelectedDate) calendarSelectedDate = showDate;
  renderCalendarEvents(events, showDate);
}

function renderCalendarEvents(events, dateStr) {
  const list = document.getElementById('cal-events-list');
  const dateLabel = document.getElementById('cal-selected-date');

  const parts = dateStr.split('-');
  const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    dateLabel.textContent = 'Today';
  } else {
    dateLabel.textContent = monthNames[d.getMonth()] + ' ' + d.getDate();
  }

  const dayEvents = events.filter(e => e.date === dateStr);
  if (dayEvents.length === 0) {
    list.innerHTML = '<p class="empty-state">No events</p>';
    return;
  }

  list.innerHTML = '';
  dayEvents.forEach(ev => {
    const agentColor = agentColors[ev.agent] || 'gray';
    const agentName = agentDisplayNames[ev.agent] || ev.agent || 'Manual';
    const div = document.createElement('div');
    div.className = 'cal-event-item';
    div.innerHTML = `
      <div class="cal-event-dot" style="background:var(--${agentColor})"></div>
      <div class="cal-event-info">
        <div class="cal-event-title">${ev.title}</div>
        <div class="cal-event-time">${formatTime(ev.time)}</div>
        <div class="cal-event-agent">Added by ${agentName}</div>
      </div>
    `;
    list.appendChild(div);
  });
}

function formatTime(time24) {
  if (!time24) return '';
  const [h, m] = time24.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
  return h12 + ':' + String(m).padStart(2, '0') + ' ' + ampm;
}

// Calendar nav
document.getElementById('cal-prev').addEventListener('click', () => {
  calendarMonth--;
  if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
  calendarSelectedDate = null;
  renderCalendar();
});
document.getElementById('cal-next').addEventListener('click', () => {
  calendarMonth++;
  if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
  calendarSelectedDate = null;
  renderCalendar();
});

// Add event modal
document.getElementById('btn-add-event').addEventListener('click', () => {
  document.getElementById('new-event-date').value = calendarSelectedDate || new Date().toISOString().split('T')[0];
  document.getElementById('new-event-time').value = '12:00';
  document.getElementById('new-event-title').value = '';
  document.getElementById('add-event-modal').classList.remove('hidden');
});

document.getElementById('btn-cancel-event').addEventListener('click', () => {
  document.getElementById('add-event-modal').classList.add('hidden');
});

document.getElementById('btn-save-event').addEventListener('click', async () => {
  const title = document.getElementById('new-event-title').value.trim();
  const date = document.getElementById('new-event-date').value;
  const time = document.getElementById('new-event-time').value;
  if (!title || !date || !time) return;

  try {
    await fetch(BACKEND_HTTP + '/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, date, time, agent: 'user' })
    });
  } catch (e) {
    console.error('Event creation error:', e);
  }

  document.getElementById('add-event-modal').classList.add('hidden');
  renderCalendar();
});

// ============================================================
// ACTIVITY LEDGER
// ============================================================
function renderLedger() {
  const list = document.getElementById('ledger-list');
  if (callHistory.length === 0) {
    list.innerHTML = '<p class="empty-state">No agent activity yet. Completed calls will appear here.</p>';
    return;
  }
  list.innerHTML = '';
  callHistory.slice().reverse().forEach(entry => {
    const div = document.createElement('div');
    div.className = 'ledger-item';
    div.innerHTML = `
      <div class="ledger-item-header">
        <span class="ledger-item-agent" style="color:var(--${agentColors[entry.agent] || 'gray'})">${agentDisplayNames[entry.agent] || entry.agent}</span>
        <span class="ledger-item-time">${entry.date}</span>
      </div>
      <div class="ledger-item-desc">${entry.contact} &middot; ${entry.duration}</div>
    `;
    list.appendChild(div);
  });
}

// Ledger navigation
document.querySelector('[data-nav="ledger-screen"]').addEventListener('click', () => {
  renderLedger();
  navigateTo('ledger-screen');
});

// ============================================================
// TRANSCRIPT
// ============================================================
function addMsg(role, text, container) {
  const target = container || document.getElementById('transcript');
  const div = document.createElement('div');
  div.className = 'msg';
  const label = { relay: 'Relay', user: 'Caller', system: 'System', instruction: 'You (whisper)' }[role] || role;
  div.innerHTML = '<div class="msg-role ' + role + '">' + label + '</div><div class="msg-text">' + text + '</div>';
  target.appendChild(div);
  target.scrollTop = target.scrollHeight;
}

function addLoading() {
  const target = document.getElementById('transcript');
  const div = document.createElement('div');
  div.className = 'msg loading-msg';
  div.innerHTML = '<div class="msg-role relay">Relay</div><div class="msg-text loading-dots"><span>.</span><span>.</span><span>.</span></div>';
  target.appendChild(div);
  target.scrollTop = target.scrollHeight;
}

function removeLoading() {
  const el = document.querySelector('.loading-msg');
  if (el) el.remove();
}

// ============================================================
// TIMER
// ============================================================
function startTimer() {
  seconds = 0;
  timerInterval = setInterval(() => {
    seconds++;
    const m = String(Math.floor(seconds / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    document.getElementById('timer').textContent = m + ':' + s;
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
}

// ============================================================
// AUDIO PLAYBACK
// ============================================================
let audioCtx = null;
async function playAudio(base64) {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  try {
    const buffer = await audioCtx.decodeAudioData(bytes.buffer.slice(0));
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start(0);
  } catch (e) {
    console.error('Audio decode error:', e);
  }
}

// ============================================================
// WEBSOCKET
// ============================================================
function connect() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(BACKEND);
    ws.onopen = () => { console.log('Connected'); resolve(); };
    ws.onerror = (e) => { console.error('WS error:', e); reject(e); };
    ws.onclose = () => { console.log('WS closed'); };
    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'relay_text') { removeLoading(); addMsg('relay', data.text); }
      if (data.type === 'relay_audio') { await playAudio(data.audio); }
      if (data.type === 'instruction_received') { addMsg('instruction', data.text); }
      if (data.type === 'call_ended') { endCall(data.transcript); }
    };
  });
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ============================================================
// MODE TOGGLE
// ============================================================
document.querySelectorAll('.toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    mode = btn.dataset.mode;
  });
});

// ============================================================
// VOICE TASK ENTRY
// ============================================================
const voiceTaskBtn = document.getElementById('btn-voice-task');
let taskRecorder = null;
let taskAudioChunks = [];
let taskRecording = false;

voiceTaskBtn.addEventListener('click', async () => {
  if (!taskRecording) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let mimeType = 'audio/webm';
      if (typeof MediaRecorder.isTypeSupported === 'function') {
        if (!MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/mp4';
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = '';
      }
      const options = mimeType ? { mimeType } : {};
      taskRecorder = new MediaRecorder(stream, options);
      taskAudioChunks = [];
      taskRecorder.ondataavailable = (ev) => { if (ev.data.size > 0) taskAudioChunks.push(ev.data); };
      taskRecorder.start();
      taskRecording = true;
      voiceTaskBtn.textContent = 'Tap to Stop';
      voiceTaskBtn.classList.add('recording');
    } catch (err) {
      alert('Microphone access denied.');
    }
  } else {
    voiceTaskBtn.textContent = 'Transcribing...';
    voiceTaskBtn.classList.remove('recording');
    taskRecorder.onstop = async () => {
      taskRecorder.stream.getTracks().forEach(t => t.stop());
      taskRecording = false;
      if (taskAudioChunks.length === 0) { voiceTaskBtn.textContent = 'Tap to Dictate'; return; }
      const blob = new Blob(taskAudioChunks, { type: taskRecorder.mimeType });
      let ext = 'webm';
      if (blob.type.includes('mp4')) ext = 'mp4';
      const formData = new FormData();
      formData.append('audio', blob, 'task.' + ext);
      try {
        const response = await fetch(BACKEND_HTTP + '/transcribe', { method: 'POST', body: formData });
        const data = await response.json();
        if (data.text) {
          const textarea = document.getElementById('task-desc');
          textarea.value = textarea.value.trim() ? textarea.value.trim() + ' ' + data.text : data.text;
        }
      } catch (err) { console.error('Task transcription error:', err); }
      voiceTaskBtn.textContent = 'Tap to Dictate';
    };
    taskRecorder.stop();
  }
});

// ============================================================
// START CALL
// ============================================================
document.getElementById('btn-start-call').addEventListener('click', async () => {
  const name = document.getElementById('contact-name').value.trim() || 'Contact';
  const task = document.getElementById('task-desc').value.trim();
  if (!task) { alert('Describe what the agent should do.'); return; }

  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  document.getElementById('call-name').textContent = name;
  document.getElementById('call-agent-tag').textContent = agentDisplayNames[currentAgent] + ' Active';
  document.getElementById('transcript').innerHTML = '';
  const _currentForCall = document.querySelector('.screen.active');
  if (_currentForCall) animateTransition(_currentForCall.id, 'call-screen', 'slide-forward');
  else show('call-screen');

  document.getElementById('sms-bar').style.display = mode === 'sms' ? 'flex' : 'none';
  document.getElementById('voice-bar').style.display = mode === 'voice' ? 'flex' : 'none';
  document.getElementById('btn-switch-mode').textContent = mode === 'sms' ? 'Switch to Voice' : 'Switch to Text';

  startTimer();
  addMsg('system', 'Connecting to ' + agentDisplayNames[currentAgent] + '...');

  try {
    await connect();
    removeLoading();
    addLoading();
    send({ type: 'start_call', context: 'Calling ' + name + '. Task: ' + task, agent: currentAgent });
  } catch (e) {
    addMsg('system', 'Failed to connect. Is the backend running?');
  }
});

// ============================================================
// SMS INPUT
// ============================================================
document.getElementById('btn-sms-send').addEventListener('click', () => {
  const input = document.getElementById('sms-input');
  const text = input.value.trim();
  if (!text) return;
  addMsg('user', text);
  addLoading();
  send({ type: 'user_text', text });
  input.value = '';
});

document.getElementById('sms-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-sms-send').click();
});

// ============================================================
// VOICE INPUT (MediaRecorder)
// ============================================================
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let recordingStream = null;

const micBtn = document.getElementById('btn-mic');

function handleMicDown(e) {
  e.preventDefault();
  if (isRecording) return;

  navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    recordingStream = stream;
    let mimeType = 'audio/webm';
    if (typeof MediaRecorder.isTypeSupported === 'function') {
      if (!MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/mp4';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = '';
    }
    const options = mimeType ? { mimeType } : {};
    mediaRecorder = new MediaRecorder(stream, options);
    audioChunks = [];
    mediaRecorder.ondataavailable = (ev) => { if (ev.data.size > 0) audioChunks.push(ev.data); };
    mediaRecorder.start();
    isRecording = true;
    micBtn.classList.add('listening');
    micBtn.textContent = 'Listening...';
  }).catch((err) => {
    console.error('Mic error:', err);
    addMsg('system', 'Microphone access denied or unavailable.');
  });
}

function handleMicUp(e) {
  e.preventDefault();
  if (!isRecording || !mediaRecorder) return;

  micBtn.classList.remove('listening');
  micBtn.textContent = 'Hold to Speak';

  mediaRecorder.onstop = async () => {
    if (recordingStream) { recordingStream.getTracks().forEach(t => t.stop()); recordingStream = null; }
    isRecording = false;
    if (audioChunks.length === 0) return;

    const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
    let ext = 'webm';
    if (blob.type.includes('mp4')) ext = 'mp4';

    const formData = new FormData();
    formData.append('audio', blob, 'recording.' + ext);

    addMsg('system', 'Transcribing...');
    try {
      const response = await fetch(BACKEND_HTTP + '/transcribe', { method: 'POST', body: formData });
      // Remove transcribing message
      const msgs = document.querySelectorAll('.msg');
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].textContent.includes('Transcribing')) { msgs[i].remove(); break; }
      }
      if (!response.ok) { addMsg('system', 'Transcription failed.'); return; }
      const data = await response.json();
      const text = data.text || '';
      if (text.trim()) { addMsg('user', text); addLoading(); send({ type: 'user_speech', text }); }
    } catch (err) {
      const msgs = document.querySelectorAll('.msg');
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].textContent.includes('Transcribing')) { msgs[i].remove(); break; }
      }
      addMsg('system', 'Connection error.');
    }
  };
  mediaRecorder.stop();
}

micBtn.addEventListener('touchstart', handleMicDown);
micBtn.addEventListener('touchend', handleMicUp);
micBtn.addEventListener('mousedown', handleMicDown);
micBtn.addEventListener('mouseup', handleMicUp);

// ============================================================
// MID-CALL MODE SWITCH
// ============================================================
document.getElementById('btn-switch-mode').addEventListener('click', () => {
  if (mode === 'sms') {
    mode = 'voice';
    document.getElementById('sms-bar').style.display = 'none';
    document.getElementById('voice-bar').style.display = 'flex';
    document.getElementById('btn-switch-mode').textContent = 'Switch to Text';
  } else {
    mode = 'sms';
    document.getElementById('sms-bar').style.display = 'flex';
    document.getElementById('voice-bar').style.display = 'none';
    document.getElementById('btn-switch-mode').textContent = 'Switch to Voice';
  }
});

// ============================================================
// END CALL
// ============================================================
document.getElementById('btn-end-call').addEventListener('click', () => {
  send({ type: 'end_call' });
  endCall(null);
});

function endCall(transcript) {
  stopTimer();
  if (ws) ws.close();

  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  const durationStr = m + ':' + s;
  document.getElementById('call-duration').textContent = 'Duration: ' + durationStr;

  document.getElementById('postcall-agent').textContent = agentDisplayNames[currentAgent];
  document.getElementById('postcall-agent').style.color = 'var(--' + agentColors[currentAgent] + ')';

  const final = document.getElementById('final-transcript');
  final.innerHTML = document.getElementById('transcript').innerHTML;
  final.querySelectorAll('.loading-msg').forEach(el => el.remove());

  // Add to call history / ledger
  const now = new Date();
  const dateStr = (now.getMonth() + 1) + '/' + now.getDate() + ' ' + now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0');
  callHistory.push({
    agent: currentAgent,
    contact: document.getElementById('contact-name').value || 'Unknown',
    duration: durationStr,
    date: dateStr,
    contactIndex: currentContactIndex
  });

  const _currentForPost = document.querySelector('.screen.active');
  if (_currentForPost) animateTransition(_currentForPost.id, 'postcall-screen', 'slide-forward');
  else show('postcall-screen');
}

// ============================================================
// DIALER
// ============================================================
document.querySelectorAll('.dial-key').forEach(key => {
  key.addEventListener('click', () => {
    const display = document.getElementById('dialer-number');
    display.value += key.dataset.key;
  });
});

document.getElementById('btn-dialer-delete').addEventListener('click', () => {
  const display = document.getElementById('dialer-number');
  display.value = display.value.slice(0, -1);
});

document.getElementById('btn-dialer-call').addEventListener('click', () => {
  // Non-functional, just visual
});

document.getElementById('btn-dialer-relay').addEventListener('click', () => {
  const number = document.getElementById('dialer-number').value.trim();
  currentAgent = 'general';
  currentContactIndex = null;

  // Pre-fill setup screen with number if entered, otherwise leave blank
  document.getElementById('contact-name').value = number || '';
  document.getElementById('task-desc').value = '';

  // Set agent badge to General (no context to determine agent)
  const badge = document.getElementById('setup-agent-badge');
  badge.querySelector('.agent-dot').className = 'agent-dot gray';
  document.getElementById('setup-agent-name').textContent = 'General';

  navigateTo('setup-screen');
});

// ============================================================
// NEW CALL / DONE
// ============================================================
document.getElementById('btn-new-call').addEventListener('click', () => {
  document.getElementById('contact-name').value = '';
  document.getElementById('task-desc').value = '';
  document.getElementById('transcript').innerHTML = '';
  currentAgent = 'general';
  currentContactIndex = null;
  navigationStack = [];
  const _currentForDone = document.querySelector('.screen.active');
  if (_currentForDone) animateTransition(_currentForDone.id, 'home-screen', 'zoom-out');
  else show('home-screen');
});

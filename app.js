// ============================================================
// CONFIGURATION - Change this to your ngrok reserved domain
// ============================================================
const BACKEND = 'wss://unentertaining-enduringly-jaimie.ngrok-free.dev';

// ============================================================
// STATE
// ============================================================
let ws = null;
let mode = 'sms';
let timerInterval = null;
let seconds = 0;
let recognition = null;

// ============================================================
// SCREEN MANAGEMENT
// ============================================================
function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
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
// TRANSCRIPT
// ============================================================
function addMsg(role, text, container) {
    const target = container || document.getElementById('transcript');
    const div = document.createElement('div');
    div.className = 'msg';
    const label = { relay: 'Relay', user: 'Caller', system: 'System', instruction: 'You (whisper)' }[role] || role;
    div.innerHTML = `<div class="msg-role ${role}">${label}</div><div class="msg-text">${text}</div>`;
    target.appendChild(div);
    target.scrollTop = target.scrollHeight;
}

function addLoading() {
    const target = document.getElementById('transcript');
    const div = document.createElement('div');
    div.className = 'msg loading-msg';
    div.innerHTML = `<div class="msg-role relay">Relay</div><div class="msg-text loading-dots"><span>.</span><span>.</span><span>.</span></div>`;
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
    // Resume context (needed on iOS after user gesture)
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
        ws.onopen = () => {
            console.log('Connected to backend');
            resolve();
        };
        ws.onerror = (e) => {
            console.error('WS error:', e);
            reject(e);
        };
        ws.onclose = () => {
            console.log('WS closed');
        };
        ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);

            if (data.type === 'relay_text') {
                removeLoading();
                addMsg('relay', data.text);
            }
            if (data.type === 'relay_audio') {
                await playAudio(data.audio);
            }
            if (data.type === 'instruction_received') {
                addMsg('instruction', data.text);
            }
            if (data.type === 'call_ended') {
                endCall(data.transcript);
            }
        };
    });
}

function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
    }
}

// ============================================================
// START CALL
// ============================================================
document.getElementById('btn-start-call').addEventListener('click', async () => {
    const name = document.getElementById('contact-name').value.trim() || 'Contact';
    const task = document.getElementById('task-desc').value.trim();
    if (!task) { alert('Describe what Relay should do.'); return; }

    // Initialize audio context on user gesture (required by iOS Safari)
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    document.getElementById('call-name').textContent = name;
    document.getElementById('transcript').innerHTML = '';
    show('call-screen');

    // Show correct input
    document.getElementById('sms-bar').style.display = mode === 'sms' ? 'flex' : 'none';
    document.getElementById('voice-bar').style.display = mode === 'voice' ? 'flex' : 'none';

    startTimer();
    addMsg('system', 'Connecting to Relay...');

    try {
        await connect();
        removeLoading();
        addLoading();
        send({ type: 'start_call', context: `Calling ${name}. Task: ${task}` });
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
// VOICE INPUT (Web Speech API)
// ============================================================
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (e) => {
        const text = e.results[0][0].transcript;
        if (text.trim()) {
            addMsg('user', text);
            addLoading();
            send({ type: 'user_speech', text });
        }
    };
    recognition.onend = () => {
        document.getElementById('btn-mic').classList.remove('listening');
    };
}

const micBtn = document.getElementById('btn-mic');
['mousedown', 'touchstart'].forEach(evt => {
    micBtn.addEventListener(evt, (e) => {
        e.preventDefault();
        if (recognition) { recognition.start(); micBtn.classList.add('listening'); }
    });
});
['mouseup', 'touchend'].forEach(evt => {
    micBtn.addEventListener(evt, (e) => {
        e.preventDefault();
        if (recognition) { recognition.stop(); }
    });
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
    document.getElementById('call-duration').textContent = `Duration: ${m}:${s}`;

    // Copy transcript to post-call screen
    const final = document.getElementById('final-transcript');
    final.innerHTML = document.getElementById('transcript').innerHTML;
    // Remove loading dots and system messages from final view
    final.querySelectorAll('.loading-msg').forEach(el => el.remove());

    show('postcall-screen');
}

// ============================================================
// NEW CALL
// ============================================================
document.getElementById('btn-new-call').addEventListener('click', () => {
    document.getElementById('contact-name').value = '';
    document.getElementById('task-desc').value = '';
    document.getElementById('transcript').innerHTML = '';
    show('setup-screen');
});

// ============================================================
// INCOMING CALL (triggered via URL: ?incoming=true&caller=Name)
// ============================================================
const params = new URLSearchParams(location.search);
if (params.get('incoming') === 'true') {
    document.getElementById('incoming-name').textContent = params.get('caller') || 'Unknown';
    show('incoming-screen');
}

document.getElementById('btn-relay').addEventListener('click', () => {
    const caller = document.getElementById('incoming-name').textContent;
    document.getElementById('contact-name').value = caller;
    document.getElementById('task-desc').value = 'Answer this incoming call. Find out what they need and handle it politely. My name is Kenny.';
    document.getElementById('btn-start-call').click();
});

document.getElementById('btn-decline').addEventListener('click', () => show('setup-screen'));
document.getElementById('btn-answer').addEventListener('click', () => {
    alert('You answered the call yourself. (In a real Relay, this would connect you directly.)');
    show('setup-screen');
});

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
// VOICE INPUT (MediaRecorder - works on iOS and Android)
// ============================================================
const BACKEND_HTTP = BACKEND.replace('wss://', 'https://');
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // Find a supported MIME type
        let mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported('audio/webm')) {
            mimeType = 'audio/mp4';
        }
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = '';  // Let the browser pick
        }

        const options = mimeType ? { mimeType } : {};
        mediaRecorder = new MediaRecorder(stream, options);
        audioChunks = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.start();
        isRecording = true;
        console.log('Recording started with MIME:', mediaRecorder.mimeType);
    } catch (err) {
        console.error('Microphone access error:', err);
        addMsg('system', 'Microphone access denied. Please allow microphone access and try again.');
    }
}

async function stopRecordingAndTranscribe() {
    if (!mediaRecorder || !isRecording) return '';

    return new Promise((resolve) => {
        mediaRecorder.onstop = async () => {
            // Stop all tracks to release the microphone
            mediaRecorder.stream.getTracks().forEach(t => t.stop());
            isRecording = false;

            if (audioChunks.length === 0) {
                resolve('');
                return;
            }

            const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
            console.log('Audio blob size:', blob.size, 'type:', blob.type);

            // Determine file extension from MIME type
            let ext = 'webm';
            if (blob.type.includes('mp4')) ext = 'mp4';
            if (blob.type.includes('wav')) ext = 'wav';

            const formData = new FormData();
            formData.append('audio', blob, 'recording.' + ext);

            try {
                addMsg('system', 'Transcribing...');
                const response = await fetch(BACKEND_HTTP + '/transcribe', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    console.error('Transcription HTTP error:', response.status);
                    // Remove the "Transcribing..." message
                    const msgs = document.querySelectorAll('.msg');
                    const last = msgs[msgs.length - 1];
                    if (last && last.textContent.includes('Transcribing')) last.remove();
                    resolve('');
                    return;
                }

                const data = await response.json();
                // Remove the "Transcribing..." message
                const msgs = document.querySelectorAll('.msg');
                const last = msgs[msgs.length - 1];
                if (last && last.textContent.includes('Transcribing')) last.remove();

                resolve(data.text || '');
            } catch (e) {
                console.error('Transcription fetch error:', e);
                const msgs = document.querySelectorAll('.msg');
                const last = msgs[msgs.length - 1];
                if (last && last.textContent.includes('Transcribing')) last.remove();
                resolve('');
            }
        };

        mediaRecorder.stop();
    });
}

const micBtn = document.getElementById('btn-mic');

micBtn.addEventListener('mousedown', async (e) => {
    e.preventDefault();
    if (!isRecording) {
        await startRecording();
        micBtn.classList.add('listening');
        micBtn.textContent = 'Listening...';
    }
});

micBtn.addEventListener('mouseup', async (e) => {
    e.preventDefault();
    if (isRecording) {
        micBtn.classList.remove('listening');
        micBtn.textContent = 'Hold to Speak';
        const text = await stopRecordingAndTranscribe();
        if (text.trim()) {
            addMsg('user', text);
            addLoading();
            send({ type: 'user_speech', text });
        }
    }
});

micBtn.addEventListener('touchstart', async (e) => {
    e.preventDefault();
    if (!isRecording) {
        await startRecording();
        micBtn.classList.add('listening');
        micBtn.textContent = 'Listening...';
    }
});

micBtn.addEventListener('touchend', async (e) => {
    e.preventDefault();
    if (isRecording) {
        micBtn.classList.remove('listening');
        micBtn.textContent = 'Hold to Speak';
        const text = await stopRecordingAndTranscribe();
        if (text.trim()) {
            addMsg('user', text);
            addLoading();
            send({ type: 'user_speech', text });
        }
    }
});

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

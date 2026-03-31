// ===== CONFIG =====
const DEFAULT_API_URL = 'https://api.example.com/v1/chat/completions';
const DEFAULT_MODEL = 'mimo-v2-pro';

// ===== STATE =====
let messages = [];
let isStreaming = false;

// ===== DOM =====
const messagesEl = document.getElementById('messages');
const welcomeEl = document.getElementById('welcome');
const inputEl = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');
const voiceBtn = document.getElementById('voiceBtn');
const statusEl = document.getElementById('status');
const settingsBtn = document.getElementById('settingsBtn');
const clearBtn = document.getElementById('clearBtn');

// ===== INIT =====
function init() {
    loadSettings();
    loadHistory();

    inputEl.addEventListener('input', onInput);
    inputEl.addEventListener('keydown', onKeydown);
    sendBtn.addEventListener('click', sendMessage);
    voiceBtn.addEventListener('click', toggleVoice);
    settingsBtn.addEventListener('click', openSettings);
    clearBtn.addEventListener('click', clearChat);

    // Suggestion chips
    document.querySelectorAll('.suggestion-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const text = chip.dataset.text;
            if (text) {
                inputEl.value = text;
                sendMessage();
            }
        });
    });

    // Register service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    inputEl.focus();
}

// ===== INPUT HANDLING =====
function onInput() {
    sendBtn.classList.toggle('active', inputEl.value.trim().length > 0);
    autoResize();
}

function autoResize() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
}

function onKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (inputEl.value.trim()) sendMessage();
    }
}

// ===== SEND MESSAGE =====
async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || isStreaming) return;

    inputEl.value = '';
    onInput();

    // Hide welcome
    if (welcomeEl) welcomeEl.style.display = 'none';

    // Add user message
    addMessage('user', text);
    messages.push({ role: 'user', content: text });
    saveHistory();

    // Show typing
    const typingId = addTyping();
    isStreaming = true;
    statusEl.textContent = 'Thinking...';
    sendBtn.classList.remove('active');

    try {
        const apiKey = getSetting('apiKey');
        const apiUrl = getSetting('apiUrl') || DEFAULT_API_URL;
        const model = getSetting('model') || DEFAULT_MODEL;
        const systemPrompt = getSetting('systemPrompt') || 
            'You are a helpful AI assistant. Be concise, helpful, and friendly.';

        // Build messages array with system prompt
        const apiMessages = [
            { role: 'system', content: systemPrompt },
            ...messages
        ];

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: apiMessages,
                stream: true,
                max_tokens: 2048,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API Error ${response.status}: ${errText}`);
        }

        // Remove typing, add AI bubble
        removeTyping(typingId);
        const bubbleId = addMessage('ai', '');
        let fullResponse = '';

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const json = line.slice(6).trim();
                    if (json === '[DONE]') break;
                    try {
                        const data = JSON.parse(json);
                        const content = data.choices?.[0]?.delta?.content;
                        if (content) {
                            fullResponse += content;
                            updateBubble(bubbleId, fullResponse);
                            scrollToBottom();
                        }
                    } catch (e) { /* skip bad chunks */ }
                }
            }
        }

        // Save assistant message
        messages.push({ role: 'assistant', content: fullResponse });
        saveHistory();
        statusEl.textContent = 'Ready';

    } catch (error) {
        removeTyping(typingId);
        addMessage('ai', `Sorry, something went wrong:\n${error.message}`);
        statusEl.textContent = 'Error';
        setTimeout(() => { statusEl.textContent = 'Ready'; }, 3000);
    }

    isStreaming = false;
}

// ===== MESSAGE UI =====
function addMessage(role, content) {
    const id = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    div.id = id;

    const isUser = role === 'user';
    div.innerHTML = `
        <div class="bubble">
            ${!isUser ? '<div class="bubble-label">✦ AI</div>' : ''}
            <span class="bubble-text">${isUser ? escapeHtml(content) : formatText(content)}</span>
        </div>
    `;

    messagesEl.appendChild(div);
    scrollToBottom();
    return id;
}

function updateBubble(id, content) {
    const el = document.querySelector(`#${id} .bubble-text`);
    if (el) el.innerHTML = formatText(content);
}

function addTyping() {
    const id = 'typing-' + Date.now();
    const div = document.createElement('div');
    div.className = 'msg ai';
    div.id = id;
    div.innerHTML = `
        <div class="bubble">
            <div class="bubble-label">✦ AI</div>
            <div class="typing">
                <span></span><span></span><span></span>
            </div>
        </div>
    `;
    messagesEl.appendChild(div);
    scrollToBottom();
    return id;
}

function removeTyping(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

function scrollToBottom() {
    requestAnimationFrame(() => {
        messagesEl.scrollTop = messagesEl.scrollHeight;
    });
}

// ===== FORMAT TEXT =====
function formatText(text) {
    if (!text) return '';
    let html = escapeHtml(text);

    // Code blocks ```...```
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
        return `<pre><code>${code.trim()}</code></pre>`;
    });

    // Inline code `...`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold **...**
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic *...*
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Line breaks
    html = html.replace(/\n/g, '<br>');

    return html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===== VOICE INPUT =====
function toggleVoice() {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
        alert('Voice input not supported in this browser. Try Chrome.');
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (voiceBtn.classList.contains('listening')) {
        if (window._recognition) window._recognition.stop();
        return;
    }

    const recognition = new SpeechRecognition();
    window._recognition = recognition;
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;

    voiceBtn.classList.add('listening');
    statusEl.textContent = 'Listening...';

    recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
        }
        inputEl.value = transcript;
        onInput();
    };

    recognition.onend = () => {
        voiceBtn.classList.remove('listening');
        statusEl.textContent = 'Ready';
        if (inputEl.value.trim()) sendMessage();
    };

    recognition.onerror = () => {
        voiceBtn.classList.remove('listening');
        statusEl.textContent = 'Ready';
    };

    recognition.start();
}

// ===== SETTINGS =====
function getSetting(key) {
    return localStorage.getItem('ai_' + key);
}

function setSetting(key, value) {
    localStorage.setItem('ai_' + key, value);
}

function loadSettings() {
    // Settings are loaded on-demand from localStorage
}

function openSettings() {
    const existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal">
            <h2>⚙️ Settings</h2>

            <label>API Key</label>
            <input type="password" id="set-apiKey" 
                   placeholder="sk-xxxxxxxx" 
                   value="${getSetting('apiKey') || ''}">

            <label>API URL</label>
            <input type="url" id="set-apiUrl" 
                   placeholder="${DEFAULT_API_URL}" 
                   value="${getSetting('apiUrl') || ''}">

            <label>Model</label>
            <input type="text" id="set-model" 
                   placeholder="${DEFAULT_MODEL}" 
                   value="${getSetting('model') || ''}">

            <label>System Prompt</label>
            <input type="text" id="set-system" 
                   placeholder="You are a helpful AI assistant..." 
                   value="${getSetting('systemPrompt') || ''}">

            <button class="modal-btn save" id="save-settings">Save</button>
            <button class="modal-btn cancel" id="cancel-settings">Cancel</button>
        </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#save-settings').onclick = () => {
        setSetting('apiKey', overlay.querySelector('#set-apiKey').value.trim());
        setSetting('apiUrl', overlay.querySelector('#set-apiUrl').value.trim());
        setSetting('model', overlay.querySelector('#set-model').value.trim());
        setSetting('systemPrompt', overlay.querySelector('#set-system').value.trim());
        overlay.remove();
        statusEl.textContent = 'Settings saved';
        setTimeout(() => { statusEl.textContent = 'Ready'; }, 2000);
    };

    overlay.querySelector('#cancel-settings').onclick = () => overlay.remove();

    overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
    };
}

// ===== HISTORY =====
function saveHistory() {
    // Keep last 50 messages to avoid localStorage limits
    const recent = messages.slice(-50);
    localStorage.setItem('ai_history', JSON.stringify(recent));
}

function loadHistory() {
    try {
        const saved = JSON.parse(localStorage.getItem('ai_history') || '[]');
        if (saved.length > 0) {
            if (welcomeEl) welcomeEl.style.display = 'none';
            messages = saved;
            saved.forEach(msg => {
                addMessage(msg.role === 'user' ? 'user' : 'ai', msg.content);
            });
        }
    } catch (e) { /* ignore */ }
}

function clearChat() {
    messages = [];
    localStorage.removeItem('ai_history');

    // Remove all messages
    const msgs = messagesEl.querySelectorAll('.msg');
    msgs.forEach(m => m.remove());

    // Show welcome again
    if (welcomeEl) welcomeEl.style.display = '';
    statusEl.textContent = 'Ready';
}

// ===== START =====
init();

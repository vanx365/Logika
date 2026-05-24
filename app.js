const SYSTEM_PROMPT = `Eres un tutor socrático de programación. Tu rol es guiar al estudiante a pensar con claridad, NUNCA darle la respuesta ni el código.

REGLAS ESTRICTAS:
1. Nunca escribas código, pseudocódigo, ni soluciones directas.
2. Haz UNA sola pregunta a la vez. Nunca hagas múltiples preguntas en un mismo mensaje.
3. Si el estudiante pide la respuesta, responde con otra pregunta que lo acerque a pensar por sí mismo.
4. Sé conciso. Máximo 3 oraciones por respuesta.
5. Cuando evalúes una especificación, busca ambigüedades: ¿qué pasa si n es 0? ¿qué pasa si n es negativo? ¿qué significa "hasta n" — inclusive o exclusiva?
6. Si la especificación es suficientemente clara y correcta, responde EXACTAMENTE con: "SPEC_APROBADA: [un elogio breve de una frase]"
7. Habla en español, tono directo y amigable.`;

let phase = 'spec'; // 'spec' | 'code' | 'review'
let conversationHistory = [];
let monacoEditor = null;
let specApproved = false;
let submittedCode = '';

// Monaco init
require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });
require(['vs/editor/editor.main'], function() {
monacoEditor = monaco.editor.create(document.getElementById('monaco-container'), {
    value: '#include <iostream>\nusing namespace std;\n\nint main() {\n    // escribe tu solución aquí\n    \n    return 0;\n}',
    language: 'cpp',
    theme: 'vs-dark',
    fontSize: 13,
    fontFamily: "'Source Code Pro', Courier, monospace",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    suggestOnTriggerCharacters: false,
    quickSuggestions: false,
    wordBasedSuggestions: false,
    parameterHints: { enabled: false },
});
});

const MONACO_THEMES = {
dark: 'vs-dark',
black: 'hc-black',
gray: 'vs-dark',
light: 'vs'
};

const BODY_CLASSES = {
dark: 'theme-dark-mode',
black: 'theme-black-mode',
gray: 'theme-gray-mode',
light: 'theme-light-mode'
};

function setTheme(name) {
  // update body class
document.body.className = BODY_CLASSES[name];
  // update monaco
if (monacoEditor) monaco.editor.setTheme(MONACO_THEMES[name]);
  // update selected dot
document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('selected'));
document.querySelector(`.theme-${name}`).classList.add('selected');
}

function switchTab(tab) {
document.getElementById('tab-spec').classList.toggle('active', tab === 'spec');
document.getElementById('tab-code').classList.toggle('active', tab === 'code');
document.getElementById('spec-editor').style.display = tab === 'spec' ? 'block' : 'none';
document.getElementById('code-editor').style.display = tab === 'code' ? 'block' : 'none';
if (monacoEditor) monacoEditor.layout();
}

function handleMainAction() {
if (phase === 'spec') submitSpec();
else if (phase === 'code') submitCode();
}

async function submitSpec() {
const spec = document.getElementById('spec-textarea').value.trim();
if (!spec) {
    addMessage('system', 'Escribe tu especificación primero.');
    return;
}

const problema = document.getElementById('problem-text').value.trim();

addMessage('user', `Mi especificación:\n\n${spec}`);
conversationHistory.push({
    role: 'user',
    content: `El estudiante escribió esta especificación para el siguiente problema:\n\n${problema}\n\nEspecificación del estudiante:\n\n${spec}\n\nEvalúala y haz UNA pregunta socrática sobre lo que sea ambiguo o incompleto. Si está completa y correcta, responde con SPEC_APROBADA.`
});

await callClaude();
}

async function sendMessage() {
const input = document.getElementById('chat-input');
const text = input.value.trim();
if (!text) return;

input.value = '';
autoResize(input);
addMessage('user', text);
conversationHistory.push({ role: 'user', content: text });

await callClaude();
}

async function submitCode() {
if (!monacoEditor) return;
const code = monacoEditor.getValue();
const spec = document.getElementById('spec-textarea').value.trim();

addMessage('system', 'Enviando código para revisión...');
switchToPhase('review');

conversationHistory.push({
    role: 'user',
    content: `El estudiante terminó su código. Aquí está:\n\n\`\`\`cpp\n${code}\n\`\`\`\n\nSu especificación original fue:\n\n${spec}\n\nCompara spec con código. Si hay divergencias, señálalas como preguntas neutras: "En tu spec dijiste X, en el código veo Y — ¿qué pasó?" Máximo 2 observaciones. Si todo coincide, felicítalo brevemente.`
});

await callClaude();
}

async function callClaude() {
setLoading(true);
const typingId = showTyping();

try {
    const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: conversationHistory
    })
    });

    const data = await response.json();
    removeTyping(typingId);

    const reply = data.content?.[0]?.text || 'Error al obtener respuesta.';
    conversationHistory.push({ role: 'assistant', content: reply });

    if (reply.includes('SPEC_APROBADA')) {
    const elogio = reply.replace('SPEC_APROBADA:', '').trim();
    addMessage('ai', `✓ ${elogio}`);
    addMessage('system', '¡Especificación aprobada! Ahora puedes escribir el código.');
    unlockCode();
    } else {
    addMessage('ai', reply);
    }

} catch (err) {
    removeTyping(typingId);
    addMessage('system', 'Error de conexión. Revisa tu API key.');
    console.error(err);
}

setLoading(false);
}

function unlockCode() {
specApproved = true;
document.getElementById('lock-overlay').style.display = 'none';
document.getElementById('badge-spec').classList.remove('active');
document.getElementById('badge-code').classList.add('active');
document.getElementById('main-action').textContent = 'enviar código';
document.getElementById('bottom-hint').textContent = 'Escribe tu solución en C++';
switchTab('code');
phase = 'code';
if (monacoEditor) monacoEditor.layout();
}

function switchToPhase(p) {
phase = p;
document.getElementById('badge-code').classList.remove('active');
document.getElementById('badge-review').classList.add('active');
ddocument.getElementById('main-action').disabled = false;
document.getElementById('main-action').textContent = 'enviar código de nuevo';
document.getElementById('bottom-hint').textContent = 'Revisando divergencias entre tu spec y tu código...';
}

function addMessage(type, text) {
const container = document.getElementById('chat-messages');
const div = document.createElement('div');
div.className = `msg msg-${type}`;
div.innerHTML = text.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/✓/g, '<span style="color:var(--accent)">✓</span>');
container.appendChild(div);
container.scrollTop = container.scrollHeight;
}

function showTyping() {
const container = document.getElementById('chat-messages');
const div = document.createElement('div');
div.className = 'typing-indicator';
div.id = 'typing-' + Date.now();
div.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
container.appendChild(div);
container.scrollTop = container.scrollHeight;
return div.id;
}

function removeTyping(id) {
const el = document.getElementById(id);
if (el) el.remove();
}

function setLoading(state) {
document.getElementById('send-btn').disabled = state;
document.getElementById('main-action').disabled = state;
}

function handleKey(e) {
if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
}
}

function autoResize(el) {
el.style.height = 'auto';
el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}

function resetAll() {
if (!confirm('¿Reiniciar todo?')) return;
location.reload();
}
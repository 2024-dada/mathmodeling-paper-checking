// chat.js — AI 对话与提示词进一步优化
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

let chatHistory = [];
let isSending = false;

function getConfig() {
  const key = ($('#key') || {}).value?.trim() || '';
  const base = (($('#base') || {}).value?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = localStorage.getItem('ps_model') || '';
  return { key, base, model };
}

function getPrompts() {
  const result = [];
  document.querySelectorAll('.paper').forEach(card => {
    const name = card.querySelector('h3')?.textContent?.trim() || `论文 ${(+card.dataset.k) + 1}`;
    const text = card.querySelector('textarea.prompt')?.value?.trim() || '';
    if (text) result.push({ name, text });
  });
  return result;
}

function buildSystem(prompts) {
  const block = prompts.map(p => `## 「${p.name}」优化提示词\n\n${p.text}`).join('\n\n---\n\n');
  return `你是数学建模论文优化专家助手。用户完成了论文自查，系统生成了如下优化提示词，供把论文内容提交给 AI 进行改写时使用：\n\n${block}\n\n---\n\n根据用户的具体需求，进一步完善优化提示词。如需提供更新后的完整提示词，请使用以下格式：\n\n\`\`\`updated-prompt:论文名称\n完整的更新后提示词\n\`\`\`\n\n用中文回复。`;
}

function parseBubble(content) {
  const blocks = [];
  const html = esc(content)
    .replace(/```updated-prompt:([^\n]*)\n([\s\S]*?)```/g, (_, name, code) => {
      const i = blocks.length;
      blocks.push({ name: name.trim(), content: code.trim() });
      return `<div class="chat-updated-block"><div class="chat-updated-title">📋 更新后提示词：${esc(name.trim())}</div><pre>${esc(code.trim())}</pre><div class="chat-apply-row" data-idx="${i}"></div></div>`;
    })
    .replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => `<pre>${esc(code)}</pre>`)
    .replace(/`([^`\n]+)`/g, (_, c) => `<code class="chat-code">${esc(c)}</code>`);
  return { html, blocks };
}

function applyPrompt(name, content) {
  const papers = [...document.querySelectorAll('.paper')];
  for (const card of papers) {
    const cardName = card.querySelector('h3')?.textContent?.trim() || '';
    const textarea = card.querySelector('textarea.prompt');
    if (!textarea) continue;
    if (papers.length === 1 || !name || cardName.includes(name) || name.includes(cardName)) {
      textarea.value = content;
      textarea.style.transition = 'border-color .4s';
      textarea.style.borderColor = 'var(--mint)';
      setTimeout(() => { textarea.style.borderColor = ''; }, 2500);
      return true;
    }
  }
  return false;
}

function appendMessage(role, content) {
  const container = $('#chatMessages');
  if (!container) return;
  const div = document.createElement('div');
  div.className = `chat-bubble chat-${role}`;
  if (role === 'assistant') {
    const { html, blocks } = parseBubble(content);
    div.innerHTML = html;
    blocks.forEach((block, i) => {
      const row = div.querySelector(`.chat-apply-row[data-idx="${i}"]`);
      if (!row) return;
      const btn = document.createElement('button');
      btn.className = 'btn sm';
      btn.style.cssText = 'border-color:var(--mint);color:var(--mint)';
      btn.textContent = '✓ 应用到提示词';
      btn.onclick = () => {
        const ok = applyPrompt(block.name, block.content);
        btn.textContent = ok ? '✓ 已应用' : '⚠ 找不到匹配论文';
        btn.disabled = true;
      };
      row.appendChild(btn);
    });
  } else if (role === 'error') {
    div.className = 'chat-bubble chat-error';
    div.textContent = content;
  } else {
    div.innerHTML = esc(content).replace(/\n/g, '<br>');
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function send() {
  if (isSending) return;
  const input = $('#chatInput');
  const status = $('#chatStatus');
  const userText = (input?.value || '').trim();
  if (!userText) return;
  const { key, base, model } = getConfig();
  if (!key || !model) {
    if (status) status.textContent = '请先填写 API Key 并选择模型';
    return;
  }
  if (chatHistory.length === 0) {
    const prompts = getPrompts();
    if (!prompts.length) {
      if (status) status.textContent = '请先完成检测，生成优化提示词后再与 AI 交流';
      return;
    }
    chatHistory.push({ role: 'system', content: buildSystem(prompts) });
  }
  chatHistory.push({ role: 'user', content: userText });
  appendMessage('user', userText);
  if (input) input.value = '';
  isSending = true;
  const sendBtn = $('#chatSend');
  if (sendBtn) sendBtn.disabled = true;
  if (status) status.textContent = 'AI 思考中…';
  try {
    const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
    if (base.includes('anthropic.com')) Object.assign(headers, { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST', headers,
      body: JSON.stringify({ model, temperature: 0.4, messages: chatHistory })
    });
    if (!resp.ok) { const t = await resp.text(); throw new Error(`API ${resp.status}: ${t.slice(0, 200)}`); }
    const data = await resp.json();
    const reply = data.choices?.[0]?.message?.content || '（无回复）';
    chatHistory.push({ role: 'assistant', content: reply });
    appendMessage('assistant', reply);
    if (status) status.textContent = '';
  } catch (e) {
    chatHistory.pop();
    appendMessage('error', '发送失败：' + e.message);
    if (status) status.textContent = '';
  } finally {
    isSending = false;
    if (sendBtn) sendBtn.disabled = false;
  }
}

function showChat() {
  const section = $('#chatSection');
  if (!section || section.style.display !== 'none') return;
  section.style.display = 'block';
  chatHistory = [];
  const msgs = $('#chatMessages');
  if (msgs) msgs.innerHTML = '';
  const st = $('#chatStatus');
  if (st) st.textContent = '';
  const info = $('#chatModelInfo');
  if (info) { const { model } = getConfig(); info.textContent = model ? `模型：${model}` : '未选择模型'; }
}

const resultsEl = document.getElementById('results');
if (resultsEl) {
  new MutationObserver(() => {
    if (resultsEl.style.display && resultsEl.style.display !== 'none') showChat();
  }).observe(resultsEl, { attributes: true, attributeFilter: ['style'] });
}

const initChat = () => {
  document.getElementById('chatSend')?.addEventListener('click', send);
  document.getElementById('chatInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  });
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initChat);
else initChat();

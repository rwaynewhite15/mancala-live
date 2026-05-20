// ── Chat ───────────────────────────────────────────────────────────────────
function addChat(type, text, name) {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  if (type === 'system') {
    div.className = 'chat-msg system';
    div.textContent = text;
  } else {
    div.className = 'chat-msg';
    div.innerHTML = `<span class="chat-who">${escHtml(name)}:</span> ${escHtml(text)}`;
  }
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}
function sendChat() {
  const el = document.getElementById('chat-input');
  const text = el.value.trim();
  if (!text) return;
  socket.emit('chat', { text });
  el.value = '';
}

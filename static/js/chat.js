// ── Chat ───────────────────────────────────────────────────────────────────
function addChat(type, text, name, role) {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  if (type === 'system') {
    div.className = 'chat-msg system';
    div.textContent = text;
  } else {
    const tag = role === 'spectator' ? '<span class="chat-tag">[Spec]</span> ' : '';
    div.className = 'chat-msg' + (role === 'spectator' ? ' spec' : '');
    div.innerHTML = `${tag}<span class="chat-who">${escHtml(name)}:</span> ${escHtml(text)}`;
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

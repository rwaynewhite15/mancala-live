// ── Screen management ──────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
}
function showTab(tab) {
  ['create','join'].forEach(t => {
    document.getElementById('tab-'+t).classList.toggle('active', t===tab);
    document.getElementById('panel-'+t).classList.toggle('hidden', t!==tab);
  });
  clearError();
}
function selectMode(m) {
  S.selectedMode = m;
  document.getElementById('mode-pvp').classList.toggle('active', m==='pvp');
  document.getElementById('mode-ai').classList.toggle('active',  m==='ai');
  document.getElementById('difficulty-row').classList.toggle('hidden', m!=='ai');
  document.getElementById('first-move-opp').textContent =
    m === 'ai' ? 'AI goes first' : 'Opponent goes first';
  document.getElementById('leaderboard-card').classList.toggle('hidden', m==='pvp');
  document.getElementById('pvp-card').classList.toggle('hidden', m==='ai');
  if (m === 'ai') loadLeaderboard();
  else loadPvpRankings();
}
function showError(msg) {
  const el = document.getElementById('error-banner');
  el.textContent = msg; el.style.display = 'block';
}
function clearError() { document.getElementById('error-banner').style.display = 'none'; }

// ── Lobby actions ──────────────────────────────────────────────────────────
function getName() { return document.getElementById('name-input').value.trim() || 'Player'; }

function createRoom() {
  clearError();
  S.myName = getName();
  S.mode = S.selectedMode;
  S.difficulty = document.getElementById('difficulty-select').value;
  const firstPlayer = document.getElementById('first-move-select').value;
  socket.emit('create_room', { name: S.myName, mode: S.mode, difficulty: S.difficulty, first_player: firstPlayer });
}
function joinRoom() {
  clearError();
  const code = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (code.length !== 6) { showError('Enter the full 6-character room code.'); return; }
  S.myName = getName();
  socket.emit('join_room_request', { name: S.myName, room_id: code });
}
function copyCode() {
  navigator.clipboard.writeText(S.roomId).then(() => {
    const btn = document.querySelector('#screen-waiting .btn');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = orig, 1500);
  });
}
function goToMainMenu() {
  cancelAnimations();
  document.getElementById('game-over-overlay').classList.remove('show');
  showScreen('lobby');
  if (S.selectedMode === 'ai') {
    if (S.difficulty) filterLeaderboard(S.difficulty);
    else loadLeaderboard();
  } else {
    loadPvpRankings();
  }
}
function requestRematch() {
  document.getElementById('game-over-overlay').classList.remove('show');
  socket.emit('rematch');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

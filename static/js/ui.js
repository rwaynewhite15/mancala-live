// ── Screen management ──────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');

  // Lobby has a live "rooms to spectate" list; subscribe only while it's visible.
  if (id === 'lobby') {
    if (typeof socket !== 'undefined' && socket.connected) socket.emit('subscribe_lobby');
  } else {
    if (typeof socket !== 'undefined' && socket.connected) socket.emit('unsubscribe_lobby');
  }
}
function showTab(tab) {
  ['create','join','spectate'].forEach(t => {
    const tabBtn = document.getElementById('tab-'+t);
    const panel  = document.getElementById('panel-'+t);
    if (tabBtn) tabBtn.classList.toggle('active', t===tab);
    if (panel)  panel.classList.toggle('hidden', t!==tab);
  });
  if (tab === 'spectate' || tab === 'join') {
    if (typeof socket !== 'undefined' && socket.connected) socket.emit('subscribe_lobby');
  }
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
function getSpectatorName() { return document.getElementById('name-input').value.trim(); }
function getPasswordOrError() {
  const pw      = document.getElementById('name-password').value;
  const confirm = document.getElementById('name-password-confirm');
  if (!confirm.classList.contains('hidden') && pw !== confirm.value) {
    showError('Passwords do not match.');
    return null;
  }
  return pw;
}

function createRoom() {
  clearError();
  const rawName = document.getElementById('name-input').value.trim();
  S.mode = S.selectedMode;
  if (S.mode === 'pvp' && !rawName) { showError('Enter a name to play PvP.'); return; }
  S.myName = rawName || 'Player';
  S.skipLeaderboard = (S.mode === 'ai' && !rawName);
  S.difficulty = document.getElementById('difficulty-select').value;
  const firstPlayer = document.getElementById('first-move-select').value;
  const password = getPasswordOrError();
  if (password === null) return;
  socket.emit('create_room', { name: S.myName, mode: S.mode, difficulty: S.difficulty, first_player: firstPlayer, password });
}
function joinFromList(roomCode) {
  clearError();
  const code = String(roomCode || '').trim().toUpperCase();
  if (code.length !== 6) return;
  const rawName = document.getElementById('name-input').value.trim();
  if (!rawName) { showError('Enter a name to join a game.'); return; }
  S.myName = rawName;
  const password = getPasswordOrError();
  if (password === null) return;
  socket.emit('join_room_request', { name: S.myName, room_id: code, password });
}
function spectateRoom(roomCode) {
  clearError();
  const code = String(roomCode || '').trim().toUpperCase();
  if (code.length !== 6) return;
  // Spectator name is taken from the name input; server fills in "Spectator N" if blank.
  S.myName = getSpectatorName();
  const password = getPasswordOrError();
  if (password === null) return;
  socket.emit('spectate_room', { name: S.myName || '', room_id: code, password });
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
  hideDisconnectBanner();
  hideForfeitBanner();
  document.getElementById('game-over-overlay').classList.remove('show');
  // Tell server we're leaving so we don't dangle as "disconnected".
  if (S.roomId && typeof socket !== 'undefined' && socket.connected) {
    socket.emit('leave_room_request');
  }
  clearSession();
  S.roomId = null; S.token = null; S.isSpectator = false; S.spectatorCount = 0;
  S.oppConnected = true; S.oppDisconnectedAt = null;
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

function claimDisconnectWin() {
  socket.emit('claim_disconnect_win');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── ELO labels ─────────────────────────────────────────────────────────────
function applyEloLabels() {
  const myNameEl  = document.getElementById('my-name-text');
  const oppNameEl = document.getElementById('opp-name-text');
  const modeEl    = document.getElementById('gh-mode');
  if (!myNameEl || !oppNameEl || !modeEl) return;

  const baseMyName  = S.isSpectator ? (myNameEl.dataset.baseName || myNameEl.textContent)
                                    : (S.myName || 'You');
  const baseOppName = S.isSpectator ? (oppNameEl.dataset.baseName || oppNameEl.textContent)
                                    : (S.oppName || 'Opponent');

  const elos = Array.isArray(S.elos) ? S.elos : null;
  let myElo, oppElo;
  if (elos) {
    if (S.isSpectator) { myElo = elos[0]; oppElo = elos[1]; }
    else if (S.playerId === 0 || S.playerId === 1) {
      myElo  = elos[S.playerId];
      oppElo = elos[1 - S.playerId];
    }
  }

  myNameEl.textContent  = myElo  != null ? `${baseMyName} (${myElo})`  : baseMyName;
  oppNameEl.textContent = oppElo != null ? `${baseOppName} (${oppElo})` : baseOppName;

  // Header label: keep prefix + swing suffix in pvp.
  let headerText;
  if (S.isSpectator) {
    headerText = S.mode === 'ai'
      ? `Spectating: ${baseMyName} vs AI (${S.difficulty})`
      : `Spectating: ${baseMyName} vs ${baseOppName}`;
  } else {
    headerText = S.mode === 'ai'
      ? `vs AI (${S.difficulty})`
      : `vs ${baseOppName}`;
  }
  if (S.mode === 'pvp' && S.mySwing && typeof S.mySwing.win === 'number') {
    const w = S.mySwing.win;
    const l = S.mySwing.loss;
    headerText += `  (worth +${w} / −${l})`;
  }
  modeEl.textContent = headerText;
}

// ── Disconnect banner ──────────────────────────────────────────────────────
function showDisconnectBanner(name, graceSeconds) {
  const banner = document.getElementById('disconnect-banner');
  if (!banner) return;
  const nameEl = document.getElementById('dc-name');
  const statusEl = document.getElementById('dc-status');
  if (statusEl) statusEl.innerHTML = 'disconnected\n        — game terminating in <span id="dc-countdown">--</span>';
  const countdownEl = document.getElementById('dc-countdown');
  if (nameEl) nameEl.textContent = name || 'Opponent';
  banner.classList.remove('hidden');

  if (disconnectCountdownTimer) {
    clearInterval(disconnectCountdownTimer);
    disconnectCountdownTimer = null;
  }
  if (graceSeconds && graceSeconds > 0) {
    let secs = graceSeconds;
    countdownEl.textContent = formatCountdown(secs);
    disconnectCountdownTimer = setInterval(() => {
      secs--;
      if (secs <= 0) {
        clearInterval(disconnectCountdownTimer);
        disconnectCountdownTimer = null;
        if (statusEl) statusEl.textContent = 'disconnected — game terminated';
      } else {
        countdownEl.textContent = formatCountdown(secs);
      }
    }, 1000);
  } else {
    countdownEl.textContent = '';
  }
}
function hideDisconnectBanner() {
  const banner = document.getElementById('disconnect-banner');
  if (banner) banner.classList.add('hidden');
  if (disconnectCountdownTimer) { clearInterval(disconnectCountdownTimer); disconnectCountdownTimer = null; }
}
function formatCountdown(s) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${String(r).padStart(2,'0')}` : `${r}s`;
}

// ── Forfeit banner ─────────────────────────────────────────────────────────
function showForfeitBanner(text) {
  const banner = document.getElementById('forfeit-banner');
  if (!banner) return;
  const msgEl = document.getElementById('forfeit-msg');
  if (msgEl) msgEl.textContent = text;
  banner.classList.remove('hidden');
}
function hideForfeitBanner() {
  const banner = document.getElementById('forfeit-banner');
  if (banner) banner.classList.add('hidden');
}


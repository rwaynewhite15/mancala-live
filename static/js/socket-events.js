// ── Socket events ──────────────────────────────────────────────────────────
socket.on('joined', data => {
  S.playerId   = data.player_id;
  S.mode       = data.mode;
  S.difficulty = data.difficulty || null;
  S.roomId     = data.room_id;
  S.oppName    = data.opponent || (data.mode === 'ai' ? `AI (${data.difficulty})` : 'Opponent');
  S.isSpectator = false;
  S.elos       = Array.isArray(data.elos) ? data.elos : null;
  S.mySwing    = data.my_swing || null;
  if (data.token) S.token = data.token;
  S.oppConnected = true;
  hideDisconnectBanner();
  hideForfeitBanner();
  saveSession();

  // Reset state for new game/room
  if (!data.rejoin) {
    prevBoard          = null;
    latestStateSeq     = 0;
    cancelAnimations();
    lastGameSummarized = -1;
    document.getElementById('my-record').textContent  = '';
    document.getElementById('opp-record').textContent = '';
    document.getElementById('chat-messages').innerHTML = '';
  } else {
    // On rejoin, keep chat & cancel any animations so a fresh state will render.
    prevBoard          = null;
    latestStateSeq     = 0;
    cancelAnimations();
  }

  document.getElementById('my-name-text').textContent  = S.myName || 'You';
  document.getElementById('opp-name-text').textContent = S.oppName;
  applyEloLabels();

  // Chat is available in PvP for players. Spectators also chat (see spectator_joined).
  document.getElementById('chat-input-row').style.display = data.mode === 'ai' ? 'none' : 'flex';

  buildBoard();
  if (data.mode !== 'pvp' || data.opponent) {
    showScreen('game');
    loadGameLeaderboard();
    if (!data.rejoin) {
      const fp = data.first_player;
      const whoFirst = fp === S.playerId ? 'You go first'
        : (data.mode === 'ai' ? 'AI goes first' : `${S.oppName} goes first`);
      addChat('system', `Game started. ${whoFirst}.`);
      if (data.mode === 'pvp' && Array.isArray(data.elos)) {
        const myElo  = data.elos[S.playerId];
        const oppElo = data.elos[1 - S.playerId];
        addChat('system', `ELO — You: ${myElo} | ${S.oppName}: ${oppElo}`);
      }
    } else {
      addChat('system', `Reconnected.`);
    }
  }
});

socket.on('spectator_joined', data => {
  S.playerId    = 0;            // spectator views from P0's perspective
  S.isSpectator = true;
  S.mode        = data.mode;
  S.difficulty  = data.difficulty || null;
  S.roomId      = data.room_id;
  S.myName      = data.your_name;
  S.oppName     = data.p1_name || 'Waiting…';
  S.elos        = Array.isArray(data.elos) ? data.elos : null;
  S.mySwing     = null;
  if (data.token) S.token = data.token;
  saveSession();

  if (!data.rejoin) {
    prevBoard = null;
    latestStateSeq = 0;
    cancelAnimations();
    lastGameSummarized = -1;
    document.getElementById('chat-messages').innerHTML = '';
  } else {
    prevBoard = null;
    latestStateSeq = 0;
    cancelAnimations();
  }

  document.getElementById('my-record').textContent  = '';
  document.getElementById('opp-record').textContent = '';
  const p0Label = data.p0_name || 'Player 1';
  const p1Label = data.p1_name || 'Waiting…';
  const myNameEl  = document.getElementById('my-name-text');
  const oppNameEl = document.getElementById('opp-name-text');
  myNameEl.textContent  = p0Label;
  oppNameEl.textContent = p1Label;
  myNameEl.dataset.baseName  = p0Label;
  oppNameEl.dataset.baseName = p1Label;
  applyEloLabels();

  // Spectators can chat in any mode (server tags messages).
  document.getElementById('chat-input-row').style.display = 'flex';

  buildBoard();
  // Disable my-pit hover/click visuals for spectators
  document.querySelectorAll('.my-pit').forEach(el => el.classList.add('spectator-locked'));

  // If the game hasn't started yet, render a placeholder board so the spectator
  // doesn't see empty pits.
  if (!data.started) {
    renderPreGameBoard();
    document.getElementById('status-bar').textContent = 'Waiting for opponent to join…';
  }

  showScreen('game');
  loadGameLeaderboard();
  if (!data.rejoin) addChat('system', `You are spectating as ${S.myName}.`);
  else addChat('system', `Reconnected as spectator.`);
});

socket.on('waiting', data => {
  S.roomId = data.room_id;
  renderPreGameBoard();
  document.getElementById('status-bar').textContent = 'Waiting for opponent to join…';
  showScreen('game');
  loadGameLeaderboard();
});

function onGameScreen() {
  return document.getElementById('screen-game').classList.contains('active');
}

socket.on('rematch_status', data => {
  if (!onGameScreen()) return;
  applyRematchStatus(data && data.requested);
});

socket.on('new_game', data => {
  if (!onGameScreen()) return;
  cancelAnimations();
  prevBoard = null;
  hideDisconnectBanner();
  hideForfeitBanner();
  resetRematchUI();
  document.getElementById('game-over-overlay').classList.remove('show');
  if (Array.isArray(data.elos)) S.elos = data.elos;
  if (data.my_swing) S.mySwing = data.my_swing;
  lastGameOverState = null;
  applyEloLabels();
  const fp = data.first_player;
  let whoFirst;
  if (S.isSpectator) {
    const myEl = document.getElementById('my-name-text');
    const oppEl = document.getElementById('opp-name-text');
    const myName = myEl.dataset.baseName || myEl.textContent;
    const oppName = oppEl.dataset.baseName || oppEl.textContent;
    whoFirst = fp === 0 ? `${myName} goes first` : `${oppName} goes first`;
  } else {
    whoFirst = fp === S.playerId ? 'You go first'
      : (S.mode === 'ai' ? 'AI goes first' : `${S.oppName || 'Opponent'} goes first`);
  }
  addChat('system', `Rematch! ${whoFirst}.`);
  if (S.mode === 'pvp' && Array.isArray(data.elos)) {
    if (S.isSpectator) {
      const myEl = document.getElementById('my-name-text');
      const oppEl = document.getElementById('opp-name-text');
      const p0 = myEl.dataset.baseName || myEl.textContent;
      const p1 = oppEl.dataset.baseName || oppEl.textContent;
      addChat('system', `ELO — ${p0}: ${data.elos[0]} | ${p1}: ${data.elos[1]}`);
    } else {
      const myElo  = data.elos[S.playerId];
      const oppElo = data.elos[1 - S.playerId];
      addChat('system', `ELO — You: ${myElo} | ${S.oppName}: ${oppElo}`);
    }
  }
  loadGameLeaderboard();
});

socket.on('state', state => {
  if (!onGameScreen()) return;
  if (typeof state.state_seq === 'number') {
    if (state.state_seq <= latestStateSeq) return;
    latestStateSeq = state.state_seq;
  }

  const boardSnapshot = prevBoard;
  prevBoard = state.board;

  // Sync the player names if the server provided them
  if (Array.isArray(state.player_names)) {
    if (S.isSpectator) {
      const p0Name = state.player_names[0] || 'Player 1';
      const p1Name = state.player_names[1] || 'Player 2';
      const myEl = document.getElementById('my-name-text');
      const oppEl = document.getElementById('opp-name-text');
      myEl.dataset.baseName  = p0Name;
      oppEl.dataset.baseName = p1Name;
      myEl.textContent  = p0Name;
      oppEl.textContent = p1Name;
      S.oppName = p1Name;
      applyEloLabels();
    } else if (S.playerId !== null) {
      const oppName = state.player_names[1 - S.playerId];
      if (oppName) {
        S.oppName = oppName;
        document.getElementById('opp-name-text').textContent = oppName;
        applyEloLabels();
      }
    }
  }

  if (state.elo_result && Array.isArray(state.elo_result.after)) {
    S.elos = state.elo_result.after.slice();
    applyEloLabels();
  }

  if (state.game_over) {
    document.getElementById('status-bar').textContent = 'Game over';
    document.getElementById('status-bar').className = '';
    showGameOver(state);
  }

  if (boardSnapshot && state.last_move) {
    const item = { boardBefore: boardSnapshot, lastMove: state.last_move, finalState: state };
    if (isAnimating) animQueue.push(item);
    else { isAnimating = true; animateMove(item.boardBefore, item.lastMove, item.finalState); }
  } else {
    if (!isAnimating) renderState(state);
  }
});

socket.on('chat', data => {
  // Use server-provided name & role so spectator chat displays correctly.
  const name = data.name || 'Anon';
  addChat('msg', data.text, name, data.role || 'player');
});

socket.on('error', data => {
  if (document.getElementById('screen-lobby').classList.contains('active'))
    showError(data.message);
  else
    addChat('system', `Error: ${data.message}`);
});

// Legacy event (kept for backwards compat): treat like opponent_disconnected.
socket.on('opponent_left', data => {
  addChat('system', data.message || 'Your opponent left.');
  document.getElementById('status-bar').textContent = 'Opponent disconnected.';
  document.getElementById('status-bar').className = '';
});

socket.on('opponent_disconnected', data => {
  if (!onGameScreen()) return;
  // For a player, the disconnected one is "the opponent" only if it isn't them.
  if (!S.isSpectator && data.player_id === S.playerId) return; // shouldn't happen, but ignore
  S.oppConnected = false;
  S.oppDisconnectedAt = Date.now();
  addChat('system', `${data.name} disconnected.`);
  // Spectators don't get the claim-win banner; players do.
  if (!S.isSpectator) {
    showDisconnectBanner(data.name, data.grace_seconds);
  } else {
    document.getElementById('status-bar').textContent = `${data.name} disconnected (waiting)...`;
  }
});

socket.on('opponent_reconnected', data => {
  if (!onGameScreen()) return;
  S.oppConnected = true;
  S.oppDisconnectedAt = null;
  addChat('system', `${data.name} reconnected.`);
  hideDisconnectBanner();
});

socket.on('opponent_grace_expired', data => {
  if (!onGameScreen()) return;
  if (S.isSpectator) {
    addChat('system', `${data.name} hasn’t returned.`);
    return;
  }
  addChat('system', `${data.name} hasn’t returned. You can claim the win.`);
  // Banner stays visible; countdown already ran out.
});

socket.on('game_forfeited', data => {
  if (!onGameScreen()) return;
  hideDisconnectBanner();
  const winnerName = data.winner_name;
  const loserName  = data.loser_name;
  if (S.isSpectator) {
    addChat('system', `${winnerName} wins by forfeit (${loserName} ${data.reason === 'left' ? 'left' : 'didn’t return'}).`);
  } else if (data.winner === S.playerId) {
    addChat('system', `You win by forfeit.`);
    showForfeitBanner(`You won — ${loserName} forfeited.`);
  } else {
    addChat('system', `You lost by forfeit (${winnerName} claimed the win).`);
    showForfeitBanner(`Forfeit recorded against you.`);
  }
});

socket.on('rejoin_failed', data => {
  clearSession();
  if (document.getElementById('screen-game').classList.contains('active')) {
    addChat('system', `Could not rejoin: ${data.message}. Returning to lobby.`);
    setTimeout(() => goToMainMenu(), 1500);
  }
});

socket.on('room_closed', data => {
  if (!onGameScreen()) return;
  addChat('system', `Game closed (${data.reason || 'closed'}).`);
  clearSession();
  setTimeout(() => {
    if (S.roomId) goToMainMenu();
  }, 1500);
});

socket.on('spectator_update', data => {
  updateSpectatorBadge(data.spectator_count);
  if (data.joined) addChat('system', `${data.joined} is now spectating.`);
  if (data.left) addChat('system', `${data.left} stopped spectating.`);
});

socket.on('rooms_update', data => {
  renderRoomsList(Array.isArray(data.rooms) ? data.rooms : []);
});

// Try to keep the session alive across short network blips.
socket.on('connect', () => {
  const sess = loadSession();
  if (sess && sess.room_id && sess.token && !S.roomId) {
    // First connect with stored session — try rejoin.
    if (sess.name) S.myName = sess.name;
    socket.emit('rejoin_room', { room_id: sess.room_id, token: sess.token });
  } else if (S.roomId && S.token) {
    // Reconnected after a blip — silently rejoin.
    socket.emit('rejoin_room', { room_id: S.roomId, token: S.token });
  }
  // Re-subscribe to lobby updates if we're on the lobby.
  if (document.getElementById('screen-lobby').classList.contains('active')) {
    socket.emit('subscribe_lobby');
  }
});

// ── Rooms lists ───────────────────────────────────────────────────────────
function renderRoomsList(roomsList) {
  _renderJoinList(roomsList.filter(r => !r.started && r.mode === 'pvp'));
  _renderSpectateList(roomsList);
}

function _roomRow(r, actions) {
  const players = (r.players || []).map(escHtml).join(' vs ') || '—';
  const modeLabel = r.mode === 'ai' ? `vs AI (${r.difficulty || 'medium'})` : 'PvP';
  const specCount = r.spectator_count ? ` · 👁 ${r.spectator_count}` : '';
  const status = !r.started ? 'Waiting' : (r.any_disconnected ? 'Player disconnected' : 'In progress');
  const meta = `${modeLabel} · ${status}${specCount}`;
  return `
    <div class="room-row">
      <div class="room-row-main">
        <div class="room-row-players">${players}</div>
        <div class="room-row-meta">${meta}</div>
      </div>
      <div class="room-row-actions">${actions}</div>
    </div>`;
}

function _renderJoinList(waiting) {
  const body = document.getElementById('join-rooms-body');
  if (!body) return;
  if (!waiting.length) {
    body.innerHTML = '<p style="color:var(--muted);text-align:center;font-size:.9rem;padding:14px">No open games right now.</p>';
    return;
  }
  body.innerHTML = waiting.map(r => {
    const code = escHtml(r.room_id);
    const joinBtn = `<button class="btn btn-primary room-row-btn" onclick="joinFromList('${code}')">Join</button>`;
    return _roomRow(r, joinBtn);
  }).join('');
}

function _renderSpectateList(active) {
  const body = document.getElementById('spec-rooms-body');
  if (!body) return;
  if (!active.length) {
    body.innerHTML = '<p style="color:var(--muted);text-align:center;font-size:.9rem;padding:14px">No games in progress.</p>';
    return;
  }
  body.innerHTML = active.map(r => {
    const code = escHtml(r.room_id);
    const watchBtn = `<button class="btn btn-secondary room-row-btn" onclick="spectateRoom('${code}')">Watch</button>`;
    return _roomRow(r, watchBtn);
  }).join('');
}

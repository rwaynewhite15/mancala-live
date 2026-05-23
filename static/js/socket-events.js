// ── Socket events ──────────────────────────────────────────────────────────
socket.on('joined', data => {
  S.playerId   = data.player_id;
  S.mode       = data.mode;
  S.difficulty = data.difficulty || null;
  S.roomId     = data.room_id;
  S.oppName    = data.opponent || (data.mode === 'ai' ? `AI (${data.difficulty})` : 'Opponent');

  // Reset state for new game/room
  prevBoard          = null;
  latestStateSeq     = 0;
  cancelAnimations();
  lastGameSummarized = -1;
  document.getElementById('my-record').textContent  = '';
  document.getElementById('opp-record').textContent = '';
  document.getElementById('chat-messages').innerHTML = '';

  document.getElementById('my-name-text').textContent  = S.myName || 'You';
  document.getElementById('opp-name-text').textContent = S.oppName;
  document.getElementById('gh-room').textContent  = `Room: ${S.roomId}`;
  document.getElementById('gh-mode').textContent  =
    data.mode === 'ai' ? `vs AI (${data.difficulty})` : `vs ${S.oppName}`;

  // Show chat input only in PvP
  document.getElementById('chat-input-row').style.display = data.mode === 'ai' ? 'none' : 'flex';

  buildBoard();
  if (data.mode !== 'pvp' || data.opponent) {
    showScreen('game');
    loadGameLeaderboard();
    const fp = data.first_player;
    const whoFirst = fp === S.playerId ? 'You go first'
      : (data.mode === 'ai' ? 'AI goes first' : `${S.oppName} goes first`);
    addChat('system', `Game started. ${whoFirst}.`);
  }
});

socket.on('waiting', data => {
  S.roomId = data.room_id;
  document.getElementById('waiting-code').textContent = S.roomId;
  showScreen('waiting');
});

function onGameScreen() {
  return document.getElementById('screen-game').classList.contains('active');
}

socket.on('new_game', data => {
  if (!onGameScreen()) return;
  cancelAnimations();
  prevBoard = null;
  document.getElementById('game-over-overlay').classList.remove('show');
  const fp = data.first_player;
  const whoFirst = fp === S.playerId ? 'You go first'
    : (S.mode === 'ai' ? 'AI goes first' : `${S.oppName || 'Opponent'} goes first`);
  addChat('system', `Rematch! ${whoFirst}.`);
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
  const name = data.from === S.playerId ? (S.myName || 'You') : (S.oppName || 'Opponent');
  addChat('msg', data.text, name);
});

socket.on('error', data => {
  if (document.getElementById('screen-lobby').classList.contains('active'))
    showError(data.message);
  else
    addChat('system', `Error: ${data.message}`);
});

socket.on('opponent_left', data => {
  addChat('system', data.message);
  document.getElementById('status-bar').textContent = 'Opponent disconnected.';
  document.getElementById('status-bar').className = '';
});

// ── Pit index helpers ──────────────────────────────────────────────────────
function myPitIndices()  {
  return S.playerId === 0 ? [0,1,2,3,4,5] : [7,8,9,10,11,12];
}
function oppPitIndices() {
  return S.playerId === 0 ? [12,11,10,9,8,7] : [5,4,3,2,1,0];
}
function myStoreIdx()  { return S.playerId === 0 ? P1_STORE : P2_STORE; }
function oppStoreIdx() { return S.playerId === 0 ? P2_STORE : P1_STORE; }

function labelToBoardIdx(label) {
  return S.playerId === 0 ? label - 1 : label + 6;
}

// ── DOM helpers ────────────────────────────────────────────────────────────
// Returns the pit DOM element for a given board index, or null
function pitEl(boardIdx) {
  const mp = myPitIndices(), op = oppPitIndices();
  const mi = mp.indexOf(boardIdx);
  if (mi !== -1) return document.getElementById(`my-pit-${mi+1}`);
  const oi = op.indexOf(boardIdx);
  if (oi !== -1) return document.getElementById(`opp-pit-${oi+1}`);
  return null;
}

function cancelAnimations() {
  animationVersion++;
  isAnimating = false;
  animQueue = [];
}

// ── Board setup ────────────────────────────────────────────────────────────
function buildBoard() {
  ['opp-pits','my-pits'].forEach(id => document.getElementById(id).innerHTML = '');

  for (let i = 1; i <= 6; i++) {
    const op = document.createElement('div');
    op.className = 'pit'; op.id = `opp-pit-${i}`;
    op.innerHTML = `<span class="stone-count">0</span>`;
    document.getElementById('opp-pits').appendChild(op);

    const mp = document.createElement('div');
    mp.className = 'pit my-pit'; mp.id = `my-pit-${i}`;
    mp.dataset.label = i;
    mp.innerHTML = `<span class="stone-count">0</span>`;
    mp.addEventListener('click', () => onPitClick(i));
    document.getElementById('my-pits').appendChild(mp);
  }
}

// ── Render board only (no status/etc.) ────────────────────────────────────
function applyBoard(board, validSet, lastPit) {
  const myPits  = myPitIndices();
  const oppPits = oppPitIndices();

  myPits.forEach((bi, i) => {
    const el = document.getElementById(`my-pit-${i+1}`);
    el.querySelector('.stone-count').textContent = board[bi];
    el.className = 'pit my-pit';
    if (board[bi] === 0) el.classList.add('empty');
    if (validSet && validSet.has(bi)) el.classList.add('valid');
    else if (!validSet) el.classList.add('disabled');
    if (bi === lastPit) el.classList.add('last-moved');
  });

  oppPits.forEach((bi, i) => {
    const el = document.getElementById(`opp-pit-${i+1}`);
    el.querySelector('.stone-count').textContent = board[bi];
    el.className = 'pit';
    if (board[bi] === 0) el.classList.add('empty');
    if (bi === lastPit) el.classList.add('last-moved');
  });

  document.getElementById('my-store-count').textContent  = board[myStoreIdx()];
  document.getElementById('opp-store-count').textContent = board[oppStoreIdx()];
  document.getElementById('my-score').textContent        = board[myStoreIdx()];
  document.getElementById('opp-score').textContent       = board[oppStoreIdx()];
}

// ── Full render (board + status) ───────────────────────────────────────────
function renderState(state) {
  const myTurn   = !S.isSpectator && state.current_player === S.playerId;
  const validSet = (!S.isSpectator && myTurn && !state.game_over)
                     ? new Set(state.valid_moves) : null;
  const lastPit  = state.last_move ? state.last_move.pit : null;

  applyBoard(state.board, validSet, lastPit);

  const scores = state.scores || {0: 0, 1: 0};
  const gp = state.games_played || 0;
  if (gp >= 1) {
    if (S.isSpectator) {
      // Bottom = P0, Top = P1 in spectator view.
      const p0W = scores[0] || 0;
      const p1W = scores[1] || 0;
      document.getElementById('my-record').textContent  = `${p0W}W–${p1W}L`;
      document.getElementById('opp-record').textContent = `${p1W}W–${p0W}L`;
    } else {
      const myW  = scores[S.playerId]     || 0;
      const oppW = scores[1 - S.playerId] || 0;
      document.getElementById('my-record').textContent  = `${myW}W–${oppW}L`;
      document.getElementById('opp-record').textContent = `${oppW}W–${myW}L`;
    }
  }

  const bottomActive = state.current_player === (S.isSpectator ? 0 : S.playerId);
  document.getElementById('my-bar').classList.toggle('active-player',  bottomActive && !state.game_over);
  document.getElementById('opp-bar').classList.toggle('active-player', !bottomActive && !state.game_over);

  // Update spectator count badge if present
  updateSpectatorBadge(state.spectator_count);

  const statusEl = document.getElementById('status-bar');
  if (state.game_over) {
    statusEl.textContent = 'Game over';
    statusEl.className = '';
    showGameOver(state);
  } else if (S.isSpectator) {
    const names = state.player_names || [S.oppName || 'P1', 'P2'];
    const turnName = names[state.current_player] || `Player ${state.current_player + 1}`;
    statusEl.textContent = `${turnName}’s turn`;
    statusEl.className = '';
    document.getElementById('game-over-overlay').classList.remove('show');
  } else {
    if (myTurn) {
      statusEl.textContent = 'Your turn';
      statusEl.className = 'your-turn';
    } else {
      const opp = S.mode === 'ai' ? `AI (${S.difficulty})` : (S.oppName || 'Opponent');
      statusEl.textContent = `Waiting for ${opp}...`;
      statusEl.className = '';
    }
    document.getElementById('game-over-overlay').classList.remove('show');
  }
}

// Render a default starting Mancala board (4 stones per pit, empty stores)
// for spectators who joined before the game started.
function renderPreGameBoard() {
  const placeholder = new Array(14).fill(4);
  placeholder[P1_STORE] = 0;
  placeholder[P2_STORE] = 0;
  applyBoard(placeholder, null, null);
  document.getElementById('my-bar').classList.remove('active-player');
  document.getElementById('opp-bar').classList.remove('active-player');
}

function updateSpectatorBadge(count) {
  if (typeof count !== 'number') return;
  S.spectatorCount = count;
  const el = document.getElementById('spectator-badge');
  if (!el) return;
  if (count > 0) {
    el.classList.remove('hidden');
    el.textContent = count === 1 ? '👁 1 spectator' : `👁 ${count} spectators`;
  } else {
    el.classList.add('hidden');
  }
}

function showGameOver(state) {
  lastGameOverState = state;

  const myS  = state.board[myStoreIdx()];
  const oppS = state.board[oppStoreIdx()];
  const w    = state.winner;
  const forfeit = state.forfeit;

  let title, color;
  const names = state.player_names || [];
  if (S.isSpectator) {
    if (w === null)        { title = "Tie!";   color = '#f0c040'; }
    else                   {
      title = `${names[w] || ('Player ' + (w+1))} Wins!`;
      color = '#50d080';
    }
  } else {
    if (w === null)           { title = "It's a Tie!"; color = '#f0c040'; }
    else if (w === S.playerId){ title = 'You Win!';    color = '#50d080'; }
    else                      { title = 'You Lose';    color = '#e05030'; }
  }
  if (forfeit && !S.isSpectator) {
    title += w === S.playerId ? ' (Forfeit)' : ' (Forfeit)';
  } else if (forfeit && S.isSpectator) {
    title += ' (Forfeit)';
  }
  const oppLabel = S.isSpectator
    ? (names[1] || 'P2')
    : (S.mode === 'ai' ? 'AI' : (S.oppName || 'Opponent'));
  const meLabel = S.isSpectator ? (names[0] || 'P1') : 'You';
  document.getElementById('game-over-title').textContent = title;
  document.getElementById('game-over-title').style.color = color;
  document.getElementById('game-over-scores').textContent = `${meLabel}: ${myS}  |  ${oppLabel}: ${oppS}`;

  const scores = state.scores || {0: 0, 1: 0};
  const gp = state.games_played || 0;
  const recEl = document.getElementById('game-over-record');
  if (gp >= 1) {
    if (S.isSpectator) {
      recEl.textContent = `Series: ${scores[0]||0} – ${scores[1]||0}`;
    } else {
      const myW  = scores[S.playerId]  || 0;
      const oppW = scores[1 - S.playerId] || 0;
      recEl.textContent = `Series: ${myW} – ${oppW}`;
    }
  } else {
    recEl.textContent = '';
  }

  // Hide rematch button for spectators
  const rematchBtn = document.getElementById('rematch-btn');
  if (rematchBtn) rematchBtn.style.display = S.isSpectator ? 'none' : '';
  resetRematchUI();

  document.getElementById('game-over-overlay').classList.add('show');

  // Once per completed game: post chat summary and auto-submit AI score
  if (gp !== lastGameSummarized) {
    lastGameSummarized = gp;
    let summary;
    if (S.isSpectator) {
      const wText = w === null ? 'Tie' : `${names[w] || ('Player ' + (w+1))} wins`;
      summary = `Game ${gp}: ${names[0]||'P1'} ${myS} – ${names[1]||'P2'} ${oppS} | ${wText}`;
      if (gp >= 1) summary += ` | Series ${scores[0]||0}–${scores[1]||0}`;
    } else {
      const opp   = S.mode === 'ai' ? 'AI' : (S.oppName || 'Opponent');
      const myW   = scores[S.playerId]      || 0;
      const oppW  = scores[1 - S.playerId]  || 0;
      let result  = w === null ? 'Tie' : (w === S.playerId ? 'You win!' : 'You lose');
      if (forfeit) result += ' (forfeit)';
      summary = `Game ${gp}: You ${myS} – ${opp} ${oppS} | ${result}`;
      if (gp >= 1) summary += ` | Series ${myW}–${oppW}`;
    }
    addChat('system', summary);
    if (state.elo_result && Array.isArray(state.elo_result.before)
        && Array.isArray(state.elo_result.after)
        && Array.isArray(state.elo_result.change)) {
      const fmtChange = c => c > 0 ? `+${c}` : (c < 0 ? `−${Math.abs(c)}` : '±0');
      const before = state.elo_result.before;
      const after  = state.elo_result.after;
      const change = state.elo_result.change;
      let eloMsg;
      if (S.isSpectator) {
        const p0 = names[0] || 'P1';
        const p1 = names[1] || 'P2';
        eloMsg = `ELO — ${p0}: ${before[0]} → ${after[0]} (${fmtChange(change[0])}) | `
               + `${p1}: ${before[1]} → ${after[1]} (${fmtChange(change[1])})`;
      } else {
        const me = S.playerId, opp = 1 - S.playerId;
        const oppName = S.oppName || 'Opponent';
        eloMsg = `ELO — You: ${before[me]} → ${after[me]} (${fmtChange(change[me])}) | `
               + `${oppName}: ${before[opp]} → ${after[opp]} (${fmtChange(change[opp])})`;
      }
      addChat('system', eloMsg);
    }
    if (!S.isSpectator && S.mode === 'ai') autoSubmitAIScore(state);
  }
}

// ── Animation ─────────────────────────────────────────────────────────────
// Compute the ordered list of board indices that receive a stone during a move
function distributionPath(board, player, pit) {
  const oppStore = player === 0 ? P2_STORE : P1_STORE;
  let stones = board[pit];
  let idx = pit;
  const path = [];
  for (let i = 0; i < stones; i++) {
    idx = (idx + 1) % 14;
    if (idx === oppStore) idx = (idx + 1) % 14;
    path.push(idx);
  }
  return path;
}

async function animateMove(boardBefore, lastMove, finalState) {
  const version = animationVersion;
  const { player, pit, captured } = lastMove;
  const isStillCurrentAnimation = () => version === animationVersion;

  const board = [...boardBefore];
  const path  = distributionPath(board, player, pit);

  // Empty the source pit
  board[pit] = 0;
  applyBoard(board, null, null);
  await sleep(200);
  if (!isStillCurrentAnimation()) return;

  // Drop one stone at a time
  for (const dest of path) {
    board[dest]++;
    applyBoard(board, null, dest);

    const el = pitEl(dest);
    if (el) {
      el.classList.add('landing');
      await sleep(300);
      el.classList.remove('landing');
    } else {
      const storeEl = dest === myStoreIdx()
        ? document.getElementById('my-store-el')
        : document.getElementById('opp-store-el');
      storeEl.style.borderColor = 'var(--gold)';
      await sleep(300);
      storeEl.style.borderColor = '';
    }
    if (!isStillCurrentAnimation()) return;
  }

  // If a capture happened, flash both pits then clear them
  if (captured) {
    const lastDest  = path[path.length - 1];
    const opp       = OPPOSITE[lastDest];
    await sleep(250);
    const captureEls = [pitEl(lastDest), pitEl(opp)].filter(Boolean);
    captureEls.forEach(el => el.classList.add('capture-flash'));
    await sleep(500);
    captureEls.forEach(el => el.classList.remove('capture-flash'));
    if (!isStillCurrentAnimation()) return;
  }

  await sleep(150);
  if (!isStillCurrentAnimation()) return;
  renderState(finalState);

  if (animQueue.length > 0) {
    const next = animQueue.shift();
    animateMove(next.boardBefore, next.lastMove, next.finalState);
  } else {
    isAnimating = false;
  }
}

// ── Pit click ──────────────────────────────────────────────────────────────
function onPitClick(label) {
  if (isAnimating) return;
  if (S.isSpectator) return; // spectators can't move
  socket.emit('move', { pit: labelToBoardIdx(label) });
}

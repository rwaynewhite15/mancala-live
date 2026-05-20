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
  const myTurn   = state.current_player === S.playerId;
  const validSet = myTurn && !state.game_over ? new Set(state.valid_moves) : null;
  const lastPit  = state.last_move ? state.last_move.pit : null;

  applyBoard(state.board, validSet, lastPit);

  const scores = state.scores || {0: 0, 1: 0};
  const gp = state.games_played || 0;
  if (gp >= 1) {
    const myW  = scores[S.playerId]     || 0;
    const oppW = scores[1 - S.playerId] || 0;
    document.getElementById('my-record').textContent  = `${myW}W–${oppW}L`;
    document.getElementById('opp-record').textContent = `${oppW}W–${myW}L`;
  }

  document.getElementById('my-bar').classList.toggle('active-player',  myTurn && !state.game_over);
  document.getElementById('opp-bar').classList.toggle('active-player', !myTurn && !state.game_over);

  const statusEl = document.getElementById('status-bar');
  if (state.game_over) {
    statusEl.textContent = 'Game over';
    statusEl.className = '';
    showGameOver(state);
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

function showGameOver(state) {
  lastGameOverState = state;
  document.getElementById('post-lb-btn').style.display = S.mode === 'ai' ? 'inline-block' : 'none';

  const myS  = state.board[myStoreIdx()];
  const oppS = state.board[oppStoreIdx()];
  const w    = state.winner;
  let title, color;
  if (w === null)           { title = "It's a Tie!"; color = '#f0c040'; }
  else if (w === S.playerId){ title = 'You Win!';    color = '#50d080'; }
  else                      { title = 'You Lose';    color = '#e05030'; }
  const opp = S.mode === 'ai' ? 'AI' : (S.oppName || 'Opponent');
  document.getElementById('game-over-title').textContent = title;
  document.getElementById('game-over-title').style.color = color;
  document.getElementById('game-over-scores').textContent = `You: ${myS}  |  ${opp}: ${oppS}`;

  const scores = state.scores || {0: 0, 1: 0};
  const gp = state.games_played || 0;
  const recEl = document.getElementById('game-over-record');
  if (gp >= 1) {
    const myW  = scores[S.playerId]  || 0;
    const oppW = scores[1 - S.playerId] || 0;
    recEl.textContent = `Series: ${myW} – ${oppW}`;
  } else {
    recEl.textContent = '';
  }

  document.getElementById('game-over-overlay').classList.add('show');

  // Post summary to chat once per completed game
  if (gp !== lastGameSummarized) {
    lastGameSummarized = gp;
    const myS   = state.board[myStoreIdx()];
    const oppS  = state.board[oppStoreIdx()];
    const opp   = S.mode === 'ai' ? 'AI' : (S.oppName || 'Opponent');
    const myW   = scores[S.playerId]      || 0;
    const oppW  = scores[1 - S.playerId]  || 0;
    let result  = w === null ? 'Tie' : (w === S.playerId ? 'You win!' : 'You lose');
    let summary = `Game ${gp}: You ${myS} – ${opp} ${oppS} | ${result}`;
    if (gp >= 1) summary += ` | Series ${myW}–${oppW}`;
    addChat('system', summary);
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
  socket.emit('move', { pit: labelToBoardIdx(label) });
}

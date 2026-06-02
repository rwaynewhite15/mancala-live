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
  const fl = document.getElementById('bead-fly-layer');
  if (fl) fl.innerHTML = '';
}

// ── Board setup ────────────────────────────────────────────────────────────
function buildBoard() {
  ['opp-pits','my-pits'].forEach(id => document.getElementById(id).innerHTML = '');
  resetBeadModel();
  ensureFlyLayer();

  for (let i = 1; i <= 6; i++) {
    const op = document.createElement('div');
    op.className = 'pit'; op.id = `opp-pit-${i}`;
    op.innerHTML = `<div class="beads"></div><span class="stone-count">0</span>`;
    document.getElementById('opp-pits').appendChild(op);

    const mp = document.createElement('div');
    mp.className = 'pit my-pit'; mp.id = `my-pit-${i}`;
    mp.dataset.label = i;
    mp.innerHTML = `<div class="beads"></div><span class="stone-count">0</span>`;
    mp.addEventListener('click', () => onPitClick(i));
    document.getElementById('my-pits').appendChild(mp);
  }
}

// ── 3D bead rendering ──────────────────────────────────────────────────────
// Glossy glass-bead palette: [highlight, base, shadow]
const BEAD_COLORS = [
  ['#ff9a9a', '#d62828', '#7a1414'],  // ruby
  ['#ffe29a', '#f0a202', '#915c00'],  // amber
  ['#9af0bd', '#1f9e57', '#0c4d2a'],  // emerald
  ['#9ec2ff', '#2f6fe0', '#16356e'],  // sapphire
  ['#dcb0ff', '#8b3fd6', '#481d70'],  // amethyst
  ['#86eded', '#0ba5a5', '#044a4a'],  // teal
  ['#fff6e6', '#efe2c4', '#b9a877'],  // ivory
  ['#ffc2a3', '#ff6b35', '#8a3010'],  // coral
];

// Stable, deterministic 0..1 hash so a given bead keeps its spot/colour
// across the many re-renders that happen during move animation.
function beadHash(key) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
  return (h >>> 0) / 4294967295;
}

function beadGradient(ci) {
  const col = BEAD_COLORS[ci % BEAD_COLORS.length];
  return `radial-gradient(circle at 32% 28%, ${col[0]}, ${col[1]} 58%, ${col[2]} 100%)`;
}

// ── Bead identity model ─────────────────────────────────────────────────────
// Each bead is a persistent entity { id, ci } (ci = palette colour index).
// The model is kept in absolute board coords [0..13]; a bead keeps its id and
// colour as it travels between wells, so identity is preserved across moves.
let BEAD_MODEL   = null;   // Array(14): each entry is an ordered list of beads
let beadIdSeq    = 0;
let beadColorSeq = 0;

function newBead() {
  return { id: ++beadIdSeq, ci: (beadColorSeq++) % BEAD_COLORS.length };
}

// Build/repair the model so each well holds exactly board[idx] beads. A no-op
// when already in sync; otherwise tops up / trims from the tail. This keeps
// identities intact for ordinary renders and is the safety net after an
// animation (e.g. end-of-game sweeps the animation doesn't replay).
function reconcileModel(board) {
  if (!BEAD_MODEL) BEAD_MODEL = Array.from({ length: 14 }, () => []);
  for (let idx = 0; idx < 14; idx++) {
    const arr = BEAD_MODEL[idx];
    while (arr.length > board[idx]) arr.pop();
    while (arr.length < board[idx]) arr.push(newBead());
  }
}

function resetBeadModel() {
  BEAD_MODEL = null;
  ['my-store-beads', 'opp-store-beads'].forEach(id => {
    const e = document.getElementById(id);
    if (e) e.innerHTML = '';
  });
  const fl = document.getElementById('bead-fly-layer');
  if (fl) fl.innerHTML = '';
}

// ── Well → DOM mapping (model is absolute; the DOM is viewer-oriented) ───────
function wellShape(idx) { return (idx === P1_STORE || idx === P2_STORE) ? 'capsule' : 'circle'; }
function wellSeed(idx)  {
  if (idx === P1_STORE) return 'store-p1';
  if (idx === P2_STORE) return 'store-p2';
  return 'pit-' + idx;
}
function wellContainer(idx) {
  if (idx === myStoreIdx())  return document.getElementById('my-store-beads');
  if (idx === oppStoreIdx()) return document.getElementById('opp-store-beads');
  const el = pitEl(idx);
  return el ? el.querySelector('.beads') : null;
}

// Deterministic slot position (uniform over the well's disk/ellipse), as a
// fraction 0..1 of the container, so a bead in slot N always sits in the same
// spot whether it's painted in place or flown to.
function slotPos(seed, slot, shape) {
  const angle = beadHash(`${seed}|a|${slot}`) * Math.PI * 2;
  const rad   = Math.sqrt(beadHash(`${seed}|r|${slot}`));
  const xR = shape === 'capsule' ? 24 : 30;
  const yR = shape === 'capsule' ? 40 : 30;
  return { fx: 0.5 + Math.cos(angle) * rad * xR / 100,
           fy: 0.5 + Math.sin(angle) * rad * yR / 100 };
}

function paintBead(el, ci, seed, slot, shape) {
  const { fx, fy } = slotPos(seed, slot, shape);
  el.style.left   = (fx * 100) + '%';
  el.style.top    = (fy * 100) + '%';
  el.style.width  = 'var(--bead-size)';   // all beads identical, pits and stores
  el.style.height = 'var(--bead-size)';
  el.style.background = beadGradient(ci);
}

// Incrementally reconcile one well's DOM with its model (keeps existing
// elements so beads never flicker; brand-new beads optionally pop in).
function renderWell(idx, popNew) {
  const c = wellContainer(idx);
  if (!c) return;
  const beads = (BEAD_MODEL && BEAD_MODEL[idx]) || [];
  const seed  = wellSeed(idx);
  const shape = wellShape(idx);
  const want  = new Set(beads.map(b => String(b.id)));
  c.querySelectorAll('.bead').forEach(el => { if (!want.has(el.dataset.bid)) el.remove(); });
  beads.forEach((b, slot) => {
    if (c.querySelector(`.bead[data-bid="${b.id}"]`)) return;
    const el = document.createElement('div');
    el.className = 'bead' + (popNew ? ' bead-drop' : '');
    el.dataset.bid = b.id;
    paintBead(el, b.ci, seed, slot, shape);
    c.appendChild(el);
  });
}

function renderAllWells() { for (let i = 0; i < 14; i++) renderWell(i); }

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

  // Keep bead identities in sync with the authoritative counts, then paint.
  reconcileModel(board);
  renderAllWells();
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

// ── Flying-bead overlay ─────────────────────────────────────────────────────
const FLY_MS = 230;            // keep in sync with .bead-fly transition
let flyLayer = null;

function ensureFlyLayer() {
  const wrap = document.getElementById('board-wrapper');
  if (!wrap) return null;
  flyLayer = document.getElementById('bead-fly-layer');
  if (!flyLayer) {
    flyLayer = document.createElement('div');
    flyLayer.id = 'bead-fly-layer';
    wrap.appendChild(flyLayer);
  }
  return flyLayer;
}

// Pixel point (within the fly layer) for a well's centre (slot < 0) or a
// specific slot. Computed live so it survives layout/resize between moves.
function wellPointPx(idx, slot) {
  const c     = wellContainer(idx);
  const layer = flyLayer || ensureFlyLayer();
  if (!c || !layer) return { x: 0, y: 0 };
  const cr = c.getBoundingClientRect();
  const lr = layer.getBoundingClientRect();
  let fx = 0.5, fy = 0.5;
  if (slot >= 0) { const p = slotPos(wellSeed(idx), slot, wellShape(idx)); fx = p.fx; fy = p.fy; }
  return { x: cr.left - lr.left + cr.width * fx,
           y: cr.top  - lr.top  + cr.height * fy };
}

// Animate one bead (carrying its colour) from `from` to `to` along a gentle
// arc, then resolve. The mid keyframe is lifted upward so the bead lobs.
function flyBead(ci, from, to) {
  return new Promise(resolve => {
    const layer = flyLayer || ensureFlyLayer();
    if (!layer) return resolve();
    const el = document.createElement('div');
    el.className = 'bead bead-fly';
    el.style.background = beadGradient(ci);
    el.style.transform  = `translate(${from.x}px, ${from.y}px) translate(-50%, -50%)`;
    layer.appendChild(el);

    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const lift = Math.min(70, dist * 0.26) + 16;      // higher arc for longer hops
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2 - lift;
    const C = 'translate(-50%, -50%)';

    let done = false;
    const finish = () => { if (done) return; done = true; el.remove(); resolve(); };

    if (typeof el.animate === 'function') {
      const anim = el.animate([
        { transform: `translate(${from.x}px, ${from.y}px) ${C}`, offset: 0 },
        { transform: `translate(${midX}px, ${midY}px) ${C}`,     offset: 0.5 },
        { transform: `translate(${to.x}px, ${to.y}px) ${C}`,     offset: 1 },
      ], { duration: FLY_MS, easing: 'cubic-bezier(.45,.05,.55,.95)', fill: 'forwards' });
      anim.onfinish = finish;
    } else {
      el.style.transition = `transform ${FLY_MS}ms ease-in-out`;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        el.style.transform = `translate(${to.x}px, ${to.y}px) ${C}`;
      }));
    }
    setTimeout(finish, FLY_MS + 160);
  });
}

// Live count chip + score update for a single well.
function setWellCount(idx, n) {
  if (idx === myStoreIdx())  { document.getElementById('my-store-count').textContent  = n;
                               document.getElementById('my-score').textContent        = n; return; }
  if (idx === oppStoreIdx()) { document.getElementById('opp-store-count').textContent = n;
                               document.getElementById('opp-score').textContent       = n; return; }
  const el = pitEl(idx);
  if (el) { el.querySelector('.stone-count').textContent = n; el.classList.toggle('empty', n === 0); }
}

function pulseWell(idx) {
  const el = pitEl(idx);
  if (el) { el.classList.add('landing'); setTimeout(() => el.classList.remove('landing'), 240); return; }
  const storeEl = idx === myStoreIdx()  ? document.getElementById('my-store-el')
                : idx === oppStoreIdx() ? document.getElementById('opp-store-el') : null;
  if (storeEl) { storeEl.classList.add('store-pulse'); setTimeout(() => storeEl.classList.remove('store-pulse'), 260); }
}

function flashWell(idx) {
  const el = pitEl(idx);
  if (el) { el.classList.add('capture-flash'); setTimeout(() => el.classList.remove('capture-flash'), 520); }
}

async function animateMove(boardBefore, lastMove, finalState) {
  const version = animationVersion;
  const alive = () => version === animationVersion;
  const { player, pit, captured } = lastMove;
  const playerStore = player === 0 ? P1_STORE : P2_STORE;

  ensureFlyLayer();
  // Make sure identities reflect the pre-move board (usually already true).
  reconcileModel(boardBefore);
  renderAllWells();

  const path = distributionPath(boardBefore, player, pit);

  // 1) Scoop every bead out of the source pit (they're now "in hand").
  const hand   = BEAD_MODEL[pit].splice(0);
  const origin = wellPointPx(pit, -1);
  renderWell(pit);
  setWellCount(pit, 0);
  pulseWell(pit);
  await sleep(170);
  if (!alive()) return;

  // 2) Sow one bead at a time; each bead keeps its colour as it travels.
  for (let s = 0; s < path.length && hand.length; s++) {
    const dest = path[s];
    const bead = hand.shift();
    const to   = wellPointPx(dest, BEAD_MODEL[dest].length);
    await flyBead(bead.ci, origin, to);
    if (!alive()) return;
    BEAD_MODEL[dest].push(bead);
    renderWell(dest);
    setWellCount(dest, BEAD_MODEL[dest].length);
    pulseWell(dest);
    await sleep(60);
    if (!alive()) return;
  }

  // 3) Capture: the landing pit + its opposite empty into the player's store,
  //    each captured bead flying across while keeping its colour.
  if (captured) {
    const lastDest = path[path.length - 1];
    const opp      = OPPOSITE[lastDest];
    flashWell(lastDest); flashWell(opp);
    await sleep(440);
    if (!alive()) return;

    const sources = [[lastDest, BEAD_MODEL[lastDest].splice(0)],
                     [opp,      BEAD_MODEL[opp].splice(0)]];
    [lastDest, opp].forEach(i => { renderWell(i); setWellCount(i, 0); });

    for (const [srcIdx, beads] of sources) {
      const from = wellPointPx(srcIdx, -1);
      for (const bead of beads) {
        const to = wellPointPx(playerStore, BEAD_MODEL[playerStore].length);
        await flyBead(bead.ci, from, to);
        if (!alive()) return;
        BEAD_MODEL[playerStore].push(bead);
        renderWell(playerStore);
        setWellCount(playerStore, BEAD_MODEL[playerStore].length);
        pulseWell(playerStore);
        await sleep(40);
        if (!alive()) return;
      }
    }
  }

  await sleep(140);
  if (!alive()) return;
  renderState(finalState);   // reconciles to the authoritative final board

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

// ── Leaderboard ────────────────────────────────────────────────────────────
function filterLeaderboard(diff) {
  lbFilter = diff;
  document.querySelectorAll('#lb-filter .toggle-btn').forEach((btn, i) => {
    btn.classList.toggle('active', ['all','easy','medium','hard'][i] === diff);
  });
  loadLeaderboard();
}

async function loadLeaderboard() {
  const body = document.getElementById('lb-body');
  if (!body) return;
  body.innerHTML = '<p style="color:var(--muted);text-align:center;font-size:.9rem">Loading...</p>';
  try {
    const url = lbFilter === 'all' ? '/leaderboard' : `/leaderboard?difficulty=${lbFilter}`;
    const res  = await fetch(url);
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) {
      body.innerHTML = '<p style="color:var(--muted);text-align:center;font-size:.9rem">No entries yet — be the first!</p>';
      return;
    }
    const trs = rows.map((r, i) => `
      <tr style="background:${i%2===0?'rgba(255,255,255,0.04)':'transparent'}">
        <td style="padding:5px 8px;color:var(--muted)">${i+1}</td>
        <td style="padding:5px 8px;font-weight:700">${escHtml(r.name)}</td>
        <td style="padding:5px 8px;color:var(--muted);text-transform:capitalize">${r.difficulty}</td>
        <td style="padding:5px 8px;text-align:right;color:#50d080;font-weight:700">${r.wins}</td>
        <td style="padding:5px 8px;text-align:right;color:#e05030">${r.losses}</td>
        <td style="padding:5px 8px;text-align:right;color:var(--muted)">${r.ties}</td>
      </tr>`).join('');
    body.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:.85rem">
        <thead><tr style="border-bottom:1px solid #0e4040">
          ${['#','Name','Diff','W','L','T'].map((h,i) =>
            `<th style="padding:4px 8px;text-align:${i>=3?'right':'left'};color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:1px;font-weight:600">${h}</th>`
          ).join('')}
        </tr></thead>
        <tbody>${trs}</tbody>
      </table>`;
  } catch(e) {
    body.innerHTML = '<p style="color:var(--muted);text-align:center;font-size:.9rem">Could not load leaderboard.</p>';
  }
}

async function autoSubmitAIScore(state) {
  const w      = state.winner;
  const wins   = w === S.playerId ? 1 : 0;
  const losses = (w !== null && w !== S.playerId) ? 1 : 0;
  const ties   = w === null ? 1 : 0;
  const payload = { name: S.myName || 'Player', difficulty: S.difficulty, wins, losses, ties };
  try {
    const res = await fetch('/submit_score', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => String(res.status));
      console.error('[leaderboard] submit_score failed:', res.status, errText);
      addChat('system', `⚠ Score not saved (${res.status}): ${errText.slice(0, 200)}`);
    }
  } catch(e) {
    console.error('[leaderboard] submit_score network error:', e);
    addChat('system', `⚠ Score not saved (network error): ${e.message}`);
  }
  loadGameLeaderboard();
}

// ── PvP card ───────────────────────────────────────────────────────────────
function fmtDate(s) {
  return new Date(s).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
}
function fmtEloChange(n) {
  return n >= 0 ? `<span style="color:#50d080">+${n}</span>` : `<span style="color:#e05030">${n}</span>`;
}

function pvpTab(tab) {
  ['rankings','history','lookup'].forEach(t => {
    document.getElementById(`pvp-${t}-panel`).classList.toggle('hidden', t !== tab);
  });
  document.querySelectorAll('#pvp-tab-bar .toggle-btn').forEach((btn, i) => {
    btn.classList.toggle('active', ['rankings','history','lookup'][i] === tab);
  });
  if (tab === 'rankings') loadPvpRankings();
  else if (tab === 'history') loadPvpHistory();
  else if (tab === 'lookup') loadPlayerList();
}

function pvpGameRows(games, highlightName) {
  if (!games.length) return '<p style="color:var(--muted);text-align:center;font-size:.9rem;margin-top:8px">No games yet.</p>';
  return games.map(g => {
    const winnerDisplay = g.winner ? (g.winner === g.p1.toLowerCase() ? g.p1 : g.p2) : null;
    const result = winnerDisplay ? `<strong>${escHtml(winnerDisplay)}</strong> wins` : 'Tie';
    const p1bold = highlightName && g.p1.toLowerCase() === highlightName.toLowerCase();
    const p2bold = highlightName && g.p2.toLowerCase() === highlightName.toLowerCase();
    return `<div style="border-bottom:1px solid #0e4040;padding:8px 2px;font-size:.83rem">
      <div style="display:flex;justify-content:space-between;margin-bottom:2px">
        <span>
          <span style="font-weight:${p1bold?800:600}">${escHtml(g.p1)}</span>
          <span style="color:var(--muted)"> vs </span>
          <span style="font-weight:${p2bold?800:600}">${escHtml(g.p2)}</span>
        </span>
        <span style="color:var(--muted);font-size:.75rem">${fmtDate(g.played_at)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;color:var(--muted)">
        <span>${g.p1_stones}–${g.p2_stones} &nbsp;|&nbsp; ${result}</span>
        <span>${escHtml(g.p1)} ${fmtEloChange(g.p1_elo_change)} (${g.p1_elo}) &nbsp; ${escHtml(g.p2)} ${fmtEloChange(g.p2_elo_change)} (${g.p2_elo})</span>
      </div>
    </div>`;
  }).join('');
}

async function loadPvpRankings() {
  const body = document.getElementById('pvp-rankings-body');
  body.innerHTML = '<p style="color:var(--muted);text-align:center;font-size:.9rem">Loading...</p>';
  try {
    const rows = await fetch('/pvp/rankings').then(r => r.json());
    if (!Array.isArray(rows) || !rows.length) {
      body.innerHTML = '<p style="color:var(--muted);text-align:center;font-size:.9rem">No players yet.</p>';
      return;
    }
    const trs = rows.map((r, i) => `
      <tr style="background:${i%2===0?'rgba(255,255,255,0.04)':'transparent'}">
        <td style="padding:5px 8px;color:var(--muted)">${i+1}</td>
        <td style="padding:5px 8px;font-weight:700">${escHtml(r.name)}</td>
        <td style="padding:5px 8px;color:var(--gold);font-weight:800">${r.elo}</td>
        <td style="padding:5px 8px;text-align:right;color:#50d080;font-weight:700">${r.wins}</td>
        <td style="padding:5px 8px;text-align:right;color:#e05030">${r.losses}</td>
        <td style="padding:5px 8px;text-align:right;color:var(--muted)">${r.ties}</td>
        <td style="padding:5px 8px;text-align:right;color:var(--muted)">${r.games}</td>
      </tr>`).join('');
    body.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:.85rem">
        <thead><tr style="border-bottom:1px solid #0e4040">
          ${['#','Name','ELO','W','L','T','GP'].map((h,i) =>
            `<th style="padding:4px 8px;text-align:${i>=3?'right':'left'};color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:1px;font-weight:600">${h}</th>`
          ).join('')}
        </tr></thead>
        <tbody>${trs}</tbody>
      </table>`;
  } catch(e) {
    body.innerHTML = '<p style="color:var(--muted);text-align:center;font-size:.9rem">Could not load rankings.</p>';
  }
}

async function loadPvpHistory() {
  const body = document.getElementById('pvp-history-body');
  body.innerHTML = '<p style="color:var(--muted);text-align:center;font-size:.9rem">Loading...</p>';
  try {
    const games = await fetch('/pvp/history').then(r => r.json());
    body.innerHTML = pvpGameRows(Array.isArray(games) ? games : []);
  } catch(e) {
    body.innerHTML = '<p style="color:var(--muted);text-align:center;font-size:.9rem">Could not load history.</p>';
  }
}

async function loadPlayerList() {
  const container = document.getElementById('pvp-player-list');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--muted);text-align:center;font-size:.85rem;margin:6px 0">Loading players...</p>';
  try {
    const rows = await fetch('/pvp/rankings').then(r => r.json());
    if (!Array.isArray(rows) || !rows.length) {
      container.innerHTML = '<p style="color:var(--muted);text-align:center;font-size:.85rem;margin:6px 0">No players yet.</p>';
      return;
    }
    container.innerHTML = `
      <div style="font-size:.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;font-weight:600">All Players</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">
        ${rows.map(r => `<button data-name="${escHtml(r.name)}" style="background:#052828;border:1.5px solid #0e4040;border-radius:8px;padding:6px 10px;color:var(--cream);font-size:.85rem;cursor:pointer;transition:border-color .15s">${escHtml(r.name)} <span style="color:var(--gold);font-weight:700">${r.elo}</span></button>`).join('')}
      </div>`;
    container.querySelectorAll('button[data-name]').forEach(btn => {
      btn.addEventListener('mouseover', () => btn.style.borderColor = 'var(--teal)');
      btn.addEventListener('mouseout',  () => btn.style.borderColor = '#0e4040');
      btn.addEventListener('click', () => lookupPlayer(btn.dataset.name));
    });
  } catch(e) {
    container.innerHTML = '<p style="color:var(--muted);text-align:center;font-size:.85rem;margin:6px 0">Could not load.</p>';
  }
}

async function lookupPlayer(nameArg) {
  const name = String(nameArg || '').trim();
  if (!name) return;
  const body = document.getElementById('pvp-lookup-body');
  body.innerHTML = '<p style="color:var(--muted);font-size:.9rem">Searching...</p>';
  try {
    const res = await fetch(`/pvp/player/${encodeURIComponent(name)}`);
    if (res.status === 404) { body.innerHTML = '<p style="color:var(--muted);font-size:.9rem">Player not found.</p>'; return; }
    const p = await res.json();
    body.innerHTML = `
      <div style="background:#052828;border-radius:10px;padding:14px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:1.1rem;font-weight:800">${escHtml(p.name)}</span>
          <span style="color:var(--gold);font-size:1.2rem;font-weight:800">${p.elo} ELO</span>
        </div>
        <div style="color:var(--muted);font-size:.85rem">
          <span style="color:#50d080;font-weight:700">${p.wins}W</span> &nbsp;
          <span style="color:#e05030">${p.losses}L</span> &nbsp;
          <span>${p.ties}T</span> &nbsp;&nbsp;
          <span>${p.games} games played</span>
        </div>
      </div>
      ${pvpGameRows(p.history, p.name)}`;
  } catch(e) {
    body.innerHTML = '<p style="color:var(--muted);font-size:.9rem">Could not load player.</p>';
  }
}

async function loadGameLeaderboard() {
  const title = document.getElementById('game-lb-title');
  const body  = document.getElementById('game-lb-body');
  body.innerHTML = '<p style="color:var(--muted);text-align:center;font-size:.9rem">Loading...</p>';
  try {
    let rows, cols;
    if (S.mode === 'ai') {
      title.textContent = `PvAI ${S.difficulty.charAt(0).toUpperCase()+S.difficulty.slice(1)} Leaderboard`;
      rows = await fetch(`/leaderboard?difficulty=${S.difficulty}`).then(r => r.json());
      if (!Array.isArray(rows) || !rows.length) { body.innerHTML = '<p style="color:var(--muted);text-align:center;font-size:.9rem">No entries yet.</p>'; return; }
      rows = rows.slice(0, 5);
      const trs = rows.map((r, i) => `
        <tr style="background:${i%2===0?'rgba(255,255,255,0.04)':'transparent'}">
          <td style="padding:4px 8px;color:var(--muted)">${i+1}</td>
          <td style="padding:4px 8px;font-weight:700">${escHtml(r.name)}</td>
          <td style="padding:4px 8px;text-align:right;color:#50d080;font-weight:700">${r.wins}</td>
          <td style="padding:4px 8px;text-align:right;color:#e05030">${r.losses}</td>
          <td style="padding:4px 8px;text-align:right;color:var(--muted)">${r.ties}</td>
        </tr>`).join('');
      cols = ['#','Name','W','L','T'];
      body.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:.83rem">
        <thead><tr style="border-bottom:1px solid #0e4040">${cols.map((h,i)=>`<th style="padding:3px 8px;text-align:${i>=2?'right':'left'};color:var(--muted);font-size:.7rem;text-transform:uppercase;letter-spacing:1px;font-weight:600">${h}</th>`).join('')}</tr></thead>
        <tbody>${trs}</tbody></table>`;
    } else {
      title.textContent = 'PvP Rankings';
      rows = await fetch('/pvp/rankings').then(r => r.json());
      if (!Array.isArray(rows) || !rows.length) { body.innerHTML = '<p style="color:var(--muted);text-align:center;font-size:.9rem">No players yet.</p>'; return; }
      rows = rows.slice(0, 5);
      const trs = rows.map((r, i) => `
        <tr style="background:${i%2===0?'rgba(255,255,255,0.04)':'transparent'}">
          <td style="padding:4px 8px;color:var(--muted)">${i+1}</td>
          <td style="padding:4px 8px;font-weight:700">${escHtml(r.name)}</td>
          <td style="padding:4px 8px;color:var(--gold);font-weight:800">${r.elo}</td>
          <td style="padding:4px 8px;text-align:right;color:#50d080;font-weight:700">${r.wins}</td>
          <td style="padding:4px 8px;text-align:right;color:#e05030">${r.losses}</td>
          <td style="padding:4px 8px;text-align:right;color:var(--muted)">${r.ties}</td>
        </tr>`).join('');
      cols = ['#','Name','ELO','W','L','T'];
      body.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:.83rem">
        <thead><tr style="border-bottom:1px solid #0e4040">${cols.map((h,i)=>`<th style="padding:3px 8px;text-align:${i>=2?'right':'left'};color:var(--muted);font-size:.7rem;text-transform:uppercase;letter-spacing:1px;font-weight:600">${h}</th>`).join('')}</tr></thead>
        <tbody>${trs}</tbody></table>`;
    }
  } catch(e) {
    body.innerHTML = '<p style="color:var(--muted);text-align:center;font-size:.9rem">Could not load.</p>';
  }
}

async function loadPlayerNames() {
  try {
    const res   = await fetch('/players/names');
    const names = await res.json();
    const sel   = document.getElementById('name-select');
    if (!sel || !Array.isArray(names)) return;
    names.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
  } catch(e) {}
}

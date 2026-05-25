const S = {
  playerId: null,
  mode: null,
  difficulty: null,
  roomId: null,
  myName: null,
  oppName: null,
  selectedMode: 'pvp',
  isSpectator: false,
  token: null,
  spectatorCount: 0,
  oppConnected: true,
  oppDisconnectedAt: null,
  skipLeaderboard: false,
  elos: null,       // [p0_elo, p1_elo] in pvp games
  mySwing: null,    // { win, loss } for the local player
};
let prevBoard = null;
let isAnimating = false;
let animQueue = [];
let latestStateSeq = 0;
let lastGameSummarized = -1;
let animationVersion = 0;
let lastGameOverState = null;
let lbFilter = 'all';
let disconnectCountdownTimer = null;

const STORAGE_KEY = 'mancala_session';
// Server keeps an empty room alive for ~5 min; give ourselves a small buffer past that.
const SESSION_MAX_AGE_MS = 10 * 60 * 1000;

function saveSession() {
  if (!S.roomId || !S.token) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      room_id: S.roomId,
      token: S.token,
      name: S.myName,
      role: S.isSpectator ? 'spectator' : 'player',
      saved_at: Date.now(),
    }));
  } catch (e) { /* localStorage may be unavailable */ }
}

function clearSession() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
}

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const sess = JSON.parse(raw);
    if (sess.saved_at && Date.now() - sess.saved_at > SESSION_MAX_AGE_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return sess;
  } catch (e) { return null; }
}

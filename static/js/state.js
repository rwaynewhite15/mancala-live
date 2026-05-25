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

function saveSession() {
  if (!S.roomId || !S.token) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      room_id: S.roomId,
      token: S.token,
      name: S.myName,
      role: S.isSpectator ? 'spectator' : 'player',
    }));
  } catch (e) { /* sessionStorage may be unavailable */ }
}

function clearSession() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) {}
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

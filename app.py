"""
Mancala - Web Server (Flask-SocketIO)
Board indices: 0-5 (P1 pits), 6 (P1 store), 7-12 (P2 pits), 13 (P2 store).
"""
import os
import random
import string
import time

from flask import Flask, render_template, request
from flask_socketio import SocketIO, join_room, emit

# ── Game constants ────────────────────────────────────────────────────────────

INITIAL_STONES = 4
NUM_PITS = 14
P1_PITS = list(range(0, 6))
P1_STORE = 6
P2_PITS = list(range(7, 13))
P2_STORE = 13
PLAYER_PITS = {0: P1_PITS, 1: P2_PITS}
PLAYER_STORE = {0: P1_STORE, 1: P2_STORE}
OPPOSITE = {i: 12 - i for i in range(0, 6)}
OPPOSITE.update({12 - i: i for i in range(0, 6)})


class MancalaGame:
    def __init__(self, first_player=0):
        self.board = [INITIAL_STONES] * NUM_PITS
        self.board[P1_STORE] = 0
        self.board[P2_STORE] = 0
        self.current_player = first_player
        self.game_over = False
        self.winner = None
        self.last_move = None

    def valid_moves(self, player=None):
        if player is None:
            player = self.current_player
        return [i for i in PLAYER_PITS[player] if self.board[i] > 0]

    def make_move(self, player, pit_idx):
        if self.game_over:
            return False, "Game already over"
        if player != self.current_player:
            return False, "Not your turn"
        if pit_idx not in PLAYER_PITS[player]:
            return False, "Not your pit"
        if self.board[pit_idx] == 0:
            return False, "Empty pit"

        stones = self.board[pit_idx]
        self.board[pit_idx] = 0
        idx = pit_idx
        opponent_store = PLAYER_STORE[1 - player]

        for _ in range(stones):
            idx = (idx + 1) % NUM_PITS
            if idx == opponent_store:
                idx = (idx + 1) % NUM_PITS
            self.board[idx] += 1

        extra_turn = (idx == PLAYER_STORE[player])

        captured = (
            idx in PLAYER_PITS[player]
            and self.board[idx] == 1
            and self.board[OPPOSITE[idx]] > 0
        )
        if captured:
            extra_turn = False  # capture never grants an extra turn
            self.board[PLAYER_STORE[player]] += self.board[idx] + self.board[OPPOSITE[idx]]
            self.board[idx] = 0
            self.board[OPPOSITE[idx]] = 0

        self.last_move = {"player": player, "pit": pit_idx,
                          "extra_turn": extra_turn, "captured": captured}

        p1_done = all(self.board[i] == 0 for i in P1_PITS)
        p2_done = all(self.board[i] == 0 for i in P2_PITS)
        if p1_done or p2_done:
            self._sweep_and_finish()
        elif not extra_turn:
            self.current_player = 1 - player
            if not self.valid_moves():
                self._sweep_and_finish()
        elif not self.valid_moves():
            self._sweep_and_finish()

        return True, "OK"

    def _sweep_and_finish(self):
        for i in P1_PITS:
            self.board[P1_STORE] += self.board[i]
            self.board[i] = 0
        for i in P2_PITS:
            self.board[P2_STORE] += self.board[i]
            self.board[i] = 0
        self.game_over = True
        s1, s2 = self.board[P1_STORE], self.board[P2_STORE]
        self.winner = 0 if s1 > s2 else (1 if s2 > s1 else None)

    def state(self):
        return {
            "board": self.board,
            "current_player": self.current_player,
            "game_over": self.game_over,
            "winner": self.winner,
            "last_move": self.last_move,
            "valid_moves": self.valid_moves(),
        }

    def copy(self):
        g = MancalaGame.__new__(MancalaGame)
        g.board = self.board[:]
        g.current_player = self.current_player
        g.game_over = self.game_over
        g.winner = self.winner
        g.last_move = None
        return g


# ── AI ────────────────────────────────────────────────────────────────────────

def _score(game, ai_player):
    return game.board[PLAYER_STORE[ai_player]] - game.board[PLAYER_STORE[1 - ai_player]]


def _minimax(game, depth, alpha, beta, ai_player):
    if game.game_over or depth == 0:
        return _score(game, ai_player)
    moves = game.valid_moves()
    if not moves:
        return _score(game, ai_player)
    maximizing = (game.current_player == ai_player)
    best = float("-inf") if maximizing else float("inf")
    for pit in moves:
        g2 = game.copy()
        g2.make_move(g2.current_player, pit)
        val = _minimax(g2, depth - 1, alpha, beta, ai_player)
        if maximizing:
            best = max(best, val)
            alpha = max(alpha, best)
        else:
            best = min(best, val)
            beta = min(beta, best)
        if beta <= alpha:
            break
    return best


def get_ai_move(game, difficulty):
    moves = game.valid_moves()
    if not moves:
        return None
    if difficulty == "easy":
        return random.choice(moves)
    depth = 3 if difficulty == "medium" else 7
    ai_player = game.current_player
    best_score, best_move = float("-inf"), moves[0]
    for pit in moves:
        g2 = game.copy()
        g2.make_move(ai_player, pit)
        score = _minimax(g2, depth - 1, float("-inf"), float("inf"), ai_player)
        if score > best_score:
            best_score, best_move = score, pit
    return best_move


# ── Flask / SocketIO setup ────────────────────────────────────────────────────

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "mancala-dev-secret")
socketio = SocketIO(app, async_mode="threading", cors_allowed_origins="*")

# room_id -> { game, mode, difficulty, players: [{sid, player_id, name}], started }
rooms = {}
sid_to_room = {}  # sid -> room_id


def _make_room_id():
    chars = string.ascii_uppercase + string.digits
    while True:
        code = "".join(random.choices(chars, k=6))
        if code not in rooms:
            return code


def _record_score(room):
    """Call once when a game ends to tally the winner."""
    if room.get("score_recorded"):
        return
    room["score_recorded"] = True
    room["games_played"] += 1
    winner = room["game"].winner
    if winner is not None:
        room["scores"][winner] += 1


def _broadcast_state(room_id):
    room = rooms.get(room_id)
    if not room or not room["game"]:
        return
    if room["game"].game_over:
        _record_score(room)
    state = room["game"].state()
    for p in room["players"]:
        socketio.emit("state", {
            **state,
            "your_player": p["player_id"],
            "scores": room["scores"],
            "games_played": room["games_played"],
        }, to=p["sid"])


def _ai_task(room_id):
    time.sleep(0.8)
    room = rooms.get(room_id)
    if not room:
        return
    game = room["game"]
    while not game.game_over and game.current_player == 1:
        pit = get_ai_move(game, room["difficulty"])
        if pit is None:
            break
        game.make_move(1, pit)
        _broadcast_state(room_id)
        if game.game_over or game.current_player != 1:
            break
        time.sleep(0.5)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


# ── Socket events ─────────────────────────────────────────────────────────────

@socketio.on("create_room")
def handle_create_room(data):
    sid = request.sid
    mode = data.get("mode", "pvp")
    difficulty = data.get("difficulty", "medium")
    name = str(data.get("name", "Player"))[:20].strip() or "Player"
    fp_raw = data.get("first_player", "0")
    first_player = random.randint(0, 1) if fp_raw == "random" else int(fp_raw)

    room_id = _make_room_id()
    rooms[room_id] = {
        "game": None,
        "mode": mode,
        "difficulty": difficulty,
        "players": [{"sid": sid, "player_id": 0, "name": name}],
        "started": False,
        "scores": {0: 0, 1: 0},
        "games_played": 0,
        "score_recorded": False,
        "next_first_player": first_player,  # used when game actually starts; alternates each rematch
    }
    sid_to_room[sid] = room_id
    join_room(room_id)

    if mode == "ai":
        rooms[room_id]["game"] = MancalaGame(first_player=first_player)
        rooms[room_id]["next_first_player"] = 1 - first_player
        rooms[room_id]["started"] = True
        emit("joined", {"room_id": room_id, "player_id": 0, "mode": "ai",
                        "difficulty": difficulty, "opponent": f"AI ({difficulty})",
                        "first_player": first_player})
        _broadcast_state(room_id)
        if first_player == 1:
            socketio.start_background_task(_ai_task, room_id)
    else:
        emit("joined", {"room_id": room_id, "player_id": 0, "mode": "pvp"})
        emit("waiting", {"room_id": room_id})


@socketio.on("join_room_request")
def handle_join_room(data):
    sid = request.sid
    room_id = str(data.get("room_id", "")).strip().upper()
    name = str(data.get("name", "Player"))[:20].strip() or "Player"

    room = rooms.get(room_id)
    if not room:
        emit("error", {"message": f'Room "{room_id}" not found.'})
        return
    if room["mode"] == "ai":
        emit("error", {"message": "Cannot join an AI game room."})
        return
    if room["started"]:
        emit("error", {"message": "That game has already started."})
        return
    if len(room["players"]) >= 2:
        emit("error", {"message": "Room is full."})
        return

    room["players"].append({"sid": sid, "player_id": 1, "name": name})
    sid_to_room[sid] = room_id
    join_room(room_id)

    fp = room["next_first_player"]
    room["next_first_player"] = 1 - fp
    room["game"] = MancalaGame(first_player=fp)
    room["started"] = True

    p0 = room["players"][0]
    p1 = room["players"][1]

    socketio.emit("joined", {
        "room_id": room_id, "player_id": 0, "mode": "pvp", "opponent": p1["name"],
        "first_player": fp,
    }, to=p0["sid"])
    emit("joined", {
        "room_id": room_id, "player_id": 1, "mode": "pvp", "opponent": p0["name"],
        "first_player": fp,
    })
    _broadcast_state(room_id)


@socketio.on("move")
def handle_move(data):
    sid = request.sid
    room_id = sid_to_room.get(sid)
    if not room_id:
        return
    room = rooms.get(room_id)
    if not room or not room["started"] or not room["game"]:
        return

    player = next((p["player_id"] for p in room["players"] if p["sid"] == sid), None)
    if player is None:
        return

    pit = data.get("pit")
    if pit is None:
        return

    ok, reason = room["game"].make_move(player, int(pit))
    if not ok:
        emit("error", {"message": reason})
        return

    _broadcast_state(room_id)

    if room["mode"] == "ai" and not room["game"].game_over and room["game"].current_player == 1:
        socketio.start_background_task(_ai_task, room_id)


@socketio.on("chat")
def handle_chat(data):
    sid = request.sid
    room_id = sid_to_room.get(sid)
    if not room_id:
        return
    room = rooms.get(room_id)
    if not room:
        return
    player = next((p for p in room["players"] if p["sid"] == sid), None)
    if not player:
        return
    text = str(data.get("text", ""))[:200].strip()
    if not text:
        return
    socketio.emit("chat", {
        "from": player["player_id"], "name": player["name"], "text": text
    }, to=room_id)


@socketio.on("rematch")
def handle_rematch():
    sid = request.sid
    room_id = sid_to_room.get(sid)
    room = rooms.get(room_id)
    if not room or not room["started"] or not room["game"].game_over:
        return
    fp = room["next_first_player"]
    room["next_first_player"] = 1 - fp
    room["game"] = MancalaGame(first_player=fp)
    room["score_recorded"] = False
    _broadcast_state(room_id)
    if room["mode"] == "ai" and fp == 1:
        socketio.start_background_task(_ai_task, room_id)


@socketio.on("disconnect")
def handle_disconnect():
    sid = request.sid
    room_id = sid_to_room.pop(sid, None)
    if not room_id:
        return
    room = rooms.get(room_id)
    if not room:
        return
    for p in room["players"]:
        if p["sid"] != sid:
            socketio.emit("opponent_left", {
                "message": "Your opponent disconnected."
            }, to=p["sid"])
    rooms.pop(room_id, None)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port, debug=False, allow_unsafe_werkzeug=True)

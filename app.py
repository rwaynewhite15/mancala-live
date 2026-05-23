"""
Mancala - Web Server (Flask-SocketIO)
Board indices: 0-5 (P1 pits), 6 (P1 store), 7-12 (P2 pits), 13 (P2 store).
"""
import os
import random
import string
import time

from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, join_room, emit

from game import (INITIAL_STONES, NUM_PITS, AI_STARTUP_DELAY, AI_MOVE_DELAY,
                  P1_PITS, P1_STORE, P2_PITS, P2_STORE,
                  PLAYER_PITS, PLAYER_STORE, OPPOSITE, MancalaGame)
from ai import get_ai_move
from db import _db_conn, _PH, _USE_PG, _record_pvp_game

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
    if room.get("score_recorded"):
        return
    room["score_recorded"] = True
    room["games_played"] += 1
    winner = room["game"].winner
    if winner is not None:
        room["scores"][winner] += 1
    if room["mode"] == "pvp":
        _record_pvp_game(room)


def _broadcast_state(room_id):
    room = rooms.get(room_id)
    if not room or not room["game"]:
        return
    if room["game"].game_over:
        _record_score(room)
    room["state_seq"] += 1
    state = room["game"].state()
    for p in room["players"]:
        socketio.emit("state", {
            **state,
            "your_player": p["player_id"],
            "scores": room["scores"],
            "games_played": room["games_played"],
            "state_seq": room["state_seq"],
        }, to=p["sid"])


def _start_ai_task(room_id):
    room = rooms.get(room_id)
    if not room:
        return
    room["ai_task_token"] = room.get("ai_task_token", 0) + 1
    token = room["ai_task_token"]
    socketio.start_background_task(_ai_task, room_id, token)


def _ai_task(room_id, token):
    time.sleep(AI_STARTUP_DELAY)
    while True:
        room = rooms.get(room_id)
        if not room or room.get("ai_task_token") != token:
            return
        game = room.get("game")
        if not game or game.game_over or game.current_player != 1:
            return
        pit = get_ai_move(game, room["difficulty"])
        if pit is None:
            return
        game.make_move(1, pit)
        room = rooms.get(room_id)
        if not room or room.get("ai_task_token") != token:
            return
        _broadcast_state(room_id)
        if game.game_over or game.current_player != 1:
            return
        time.sleep(AI_MOVE_DELAY)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/ping")
def ping():
    return jsonify({"ok": True})


@app.route("/leaderboard")
def leaderboard():
    difficulty = request.args.get("difficulty", "")
    try:
        conn = _db_conn()
        cur = conn.cursor()
        if difficulty in ("easy", "medium", "hard"):
            cur.execute(
                f"SELECT display_name, difficulty, wins, losses, ties FROM leaderboard "
                f"WHERE difficulty = {_PH} ORDER BY wins DESC, losses ASC, ties DESC LIMIT 20",
                (difficulty,)
            )
        else:
            cur.execute(
                "SELECT display_name, difficulty, wins, losses, ties FROM leaderboard "
                "ORDER BY wins DESC, losses ASC, ties DESC LIMIT 20"
            )
        rows = cur.fetchall()
        conn.close()
        return jsonify([
            {"name": r[0], "difficulty": r[1], "wins": r[2], "losses": r[3], "ties": r[4]}
            for r in rows
        ])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/submit_score", methods=["POST"])
def submit_score():
    data = request.get_json(force=True) or {}
    name = str(data.get("name", "")).strip()[:20] or "Player"
    difficulty = data.get("difficulty", "")
    try:
        wins   = int(data.get("wins",   0))
        losses = int(data.get("losses", 0))
        ties   = int(data.get("ties",   0))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid data"}), 400
    if difficulty not in ("easy", "medium", "hard"):
        return jsonify({"error": "Invalid difficulty"}), 400
    if wins + losses + ties == 0:
        return jsonify({"error": "No games played"}), 400
    try:
        conn = _db_conn()
        cur = conn.cursor()
        cur.execute(
            f"INSERT INTO leaderboard "
            f"(name_lower, display_name, difficulty, wins, losses, ties) "
            f"VALUES ({_PH}, {_PH}, {_PH}, {_PH}, {_PH}, {_PH}) "
            f"ON CONFLICT (name_lower, difficulty) DO UPDATE SET "
            f"display_name = EXCLUDED.display_name, "
            f"wins = leaderboard.wins + EXCLUDED.wins, "
            f"losses = leaderboard.losses + EXCLUDED.losses, "
            f"ties = leaderboard.ties + EXCLUDED.ties, "
            f"submitted_at = " + ("NOW()" if _USE_PG else "datetime('now')"),
            (name.lower(), name, difficulty, wins, losses, ties)
        )
        conn.commit()
        conn.close()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/pvp/rankings")
def pvp_rankings():
    try:
        conn = _db_conn()
        cur = conn.cursor()
        cur.execute(
            "SELECT display_name, elo, wins, losses, ties, games_played "
            "FROM players ORDER BY elo DESC LIMIT 20"
        )
        rows = cur.fetchall()
        conn.close()
        return jsonify([
            {"name": r[0], "elo": r[1], "wins": r[2], "losses": r[3], "ties": r[4], "games": r[5]}
            for r in rows
        ])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/pvp/history")
def pvp_history():
    try:
        conn = _db_conn()
        cur = conn.cursor()
        cur.execute(
            "SELECT p1_display, p2_display, p1_stones, p2_stones, winner_name, "
            "p1_elo_change, p2_elo_change, p1_elo_after, p2_elo_after, played_at "
            "FROM pvp_games ORDER BY played_at DESC LIMIT 50"
        )
        rows = cur.fetchall()
        conn.close()
        return jsonify([{
            "p1": r[0], "p2": r[1], "p1_stones": r[2], "p2_stones": r[3],
            "winner": r[4], "p1_elo_change": r[5], "p2_elo_change": r[6],
            "p1_elo": r[7], "p2_elo": r[8], "played_at": str(r[9])
        } for r in rows])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/pvp/player/<name>")
def pvp_player(name):
    key = name.strip().lower()
    try:
        conn = _db_conn()
        cur = conn.cursor()
        cur.execute(
            f"SELECT display_name, elo, wins, losses, ties, games_played FROM players WHERE name = {_PH}",
            (key,)
        )
        player = cur.fetchone()
        if not player:
            return jsonify({"error": "Player not found"}), 404
        cur.execute(
            f"SELECT p1_display, p2_display, p1_stones, p2_stones, winner_name, "
            f"p1_elo_change, p2_elo_change, p1_elo_after, p2_elo_after, played_at "
            f"FROM pvp_games WHERE p1_name = {_PH} OR p2_name = {_PH} "
            f"ORDER BY played_at DESC LIMIT 20",
            (key, key)
        )
        games = cur.fetchall()
        conn.close()
        return jsonify({
            "name": player[0], "elo": player[1],
            "wins": player[2], "losses": player[3], "ties": player[4], "games": player[5],
            "history": [{
                "p1": g[0], "p2": g[1], "p1_stones": g[2], "p2_stones": g[3],
                "winner": g[4], "p1_elo_change": g[5], "p2_elo_change": g[6],
                "p1_elo": g[7], "p2_elo": g[8], "played_at": str(g[9])
            } for g in games]
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


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
        "ai_task_token": 0,
        "state_seq": 0,
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
            _start_ai_task(room_id)
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
        _start_ai_task(room_id)


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
    room["ai_task_token"] = room.get("ai_task_token", 0) + 1
    for p in room["players"]:
        socketio.emit("new_game", {"first_player": fp}, to=p["sid"])
    _broadcast_state(room_id)
    if room["mode"] == "ai" and room["game"].current_player == 1:
        token = room["ai_task_token"]
        socketio.start_background_task(_ai_task, room_id, token)


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

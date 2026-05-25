"""
Mancala - Web Server (Flask-SocketIO)
Board indices: 0-5 (P1 pits), 6 (P1 store), 7-12 (P2 pits), 13 (P2 store).
"""
import os
import random
import string
import time
import uuid

from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, join_room, leave_room, emit

from game import (INITIAL_STONES, NUM_PITS, AI_STARTUP_DELAY, AI_MOVE_DELAY,
                  P1_PITS, P1_STORE, P2_PITS, P2_STORE,
                  PLAYER_PITS, PLAYER_STORE, OPPOSITE, MancalaGame)
from ai import get_ai_move
from db import _db_conn, _PH, _USE_PG, _record_pvp_game

# ── Flask / SocketIO setup ────────────────────────────────────────────────────

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "mancala-dev-secret")
socketio = SocketIO(app, async_mode="threading", cors_allowed_origins="*")

DISCONNECT_GRACE_SECONDS = 120  # 2 minutes for a disconnected player to rejoin
ABANDONED_ROOM_TTL_SECONDS = 300  # how long a fully-empty room is kept alive
LOBBY_ROOM = "__lobby__"
MAX_SPECTATORS = 20

# room_id -> {
#   game, mode, difficulty,
#   players: [{sid, player_id, name, token, connected}, ...],
#   spectators: [{sid, name, token}, ...],
#   started, scores, games_played, score_recorded,
#   ai_task_token, state_seq, next_first_player, first_player,
#   forfeit, disconnect_tokens, cleanup_token,
# }
rooms = {}
sid_to_room = {}  # sid -> room_id


def _make_room_id():
    chars = string.ascii_uppercase + string.digits
    while True:
        code = "".join(random.choices(chars, k=6))
        if code not in rooms:
            return code


def _make_token():
    return uuid.uuid4().hex


def _find_role(room, sid):
    """Returns (role_str, entry_dict) or (None, None)."""
    for p in room["players"]:
        if p["sid"] == sid:
            return ("player", p)
    for s in room["spectators"]:
        if s["sid"] == sid:
            return ("spectator", s)
    return (None, None)


def _player_by_token(room, token):
    if not token:
        return None
    return next((p for p in room["players"] if p.get("token") == token), None)


def _opponent(room, player):
    return next((p for p in room["players"] if p["player_id"] != player["player_id"]), None)


def _connected_players(room):
    return [p for p in room["players"] if p.get("connected")]


def _next_spectator_name(room):
    existing = {s["name"] for s in room["spectators"]}
    n = 1
    while f"Spectator {n}" in existing:
        n += 1
    return f"Spectator {n}"


def _public_room_summary(room_id, room):
    p_names = [p.get("name", "?") for p in room["players"]]
    in_progress = bool(room.get("game") and not room["game"].game_over)
    return {
        "room_id": room_id,
        "mode": room["mode"],
        "difficulty": room.get("difficulty"),
        "players": p_names,
        "started": bool(room.get("started")),
        "in_progress": in_progress,
        "spectator_count": len(room["spectators"]),
        "any_disconnected": any(not p.get("connected", True) for p in room["players"]),
    }


def _broadcast_rooms_update():
    """Send list of joinable / watchable rooms to lobby subscribers."""
    summaries = []
    for rid, room in rooms.items():
        # Show PvP rooms waiting for a 2nd player, or any room with an active game.
        is_open = (room["mode"] == "pvp" and not room.get("started")
                   and len(room["players"]) < 2)
        is_active = room.get("started") and room.get("game") and not room["game"].game_over
        if is_open or is_active:
            summaries.append(_public_room_summary(rid, room))
    socketio.emit("rooms_update", {"rooms": summaries}, to=LOBBY_ROOM)


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
    base = {
        **state,
        "scores": room["scores"],
        "games_played": room["games_played"],
        "state_seq": room["state_seq"],
        "forfeit": room.get("forfeit"),
        "spectator_count": len(room["spectators"]),
        "player_names": [p["name"] for p in room["players"]],
        "players_connected": [bool(p.get("connected")) for p in room["players"]],
    }
    for p in room["players"]:
        if p.get("sid"):
            socketio.emit("state", {**base, "your_player": p["player_id"]}, to=p["sid"])
    for s in room["spectators"]:
        if s.get("sid"):
            socketio.emit("state", {**base, "your_player": None}, to=s["sid"])


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
        # If the human player isn't connected, pause the AI loop.
        human = next((p for p in room["players"] if p["player_id"] == 0), None)
        if room["mode"] == "ai" and human and not human.get("connected"):
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


def _schedule_grace_task(room_id, player_id):
    room = rooms.get(room_id)
    if not room:
        return
    room.setdefault("disconnect_tokens", {})
    token = _make_token()
    room["disconnect_tokens"][player_id] = token
    socketio.start_background_task(_grace_task, room_id, player_id, token)


def _grace_task(room_id, player_id, token):
    time.sleep(DISCONNECT_GRACE_SECONDS)
    room = rooms.get(room_id)
    if not room:
        return
    if room.get("disconnect_tokens", {}).get(player_id) != token:
        return  # superseded (rejoined or claimed)
    player = next((p for p in room["players"] if p["player_id"] == player_id), None)
    if not player or player.get("connected"):
        return
    socketio.emit("opponent_grace_expired", {
        "player_id": player_id,
        "name": player["name"],
    }, to=room_id)


def _schedule_empty_cleanup(room_id):
    room = rooms.get(room_id)
    if not room:
        return
    token = _make_token()
    room["cleanup_token"] = token
    socketio.start_background_task(_empty_cleanup_task, room_id, token)


def _empty_cleanup_task(room_id, token):
    time.sleep(ABANDONED_ROOM_TTL_SECONDS)
    room = rooms.get(room_id)
    if not room or room.get("cleanup_token") != token:
        return
    has_connected = (any(p.get("connected") and p.get("sid") for p in room["players"])
                     or any(s.get("sid") for s in room["spectators"]))
    if not has_connected:
        _destroy_room(room_id, reason="abandoned")


def _destroy_room(room_id, reason="closed"):
    room = rooms.pop(room_id, None)
    if room:
        room["ai_task_token"] = (room.get("ai_task_token", 0) or 0) + 1  # cancel AI loop
        socketio.emit("room_closed", {"reason": reason}, to=room_id)
    _broadcast_rooms_update()


def _force_forfeit(room, winner_player_id, loser_name):
    """End the current game with winner_player_id winning by forfeit."""
    game = room.get("game")
    if not game:
        return
    # Sweep remaining stones in pits to their owners' stores so the totals are real,
    # then if the would-be winner isn't ahead, give them the win anyway.
    for i in P1_PITS:
        game.board[P1_STORE] += game.board[i]
        game.board[i] = 0
    for i in P2_PITS:
        game.board[P2_STORE] += game.board[i]
        game.board[i] = 0
    game.game_over = True
    game.winner = winner_player_id
    room["forfeit"] = {
        "winner": winner_player_id,
        "loser_name": loser_name,
    }


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

@socketio.on("subscribe_lobby")
def handle_subscribe_lobby():
    join_room(LOBBY_ROOM)
    summaries = []
    for rid, room in rooms.items():
        is_open = (room["mode"] == "pvp" and not room.get("started")
                   and len(room["players"]) < 2)
        is_active = room.get("started") and room.get("game") and not room["game"].game_over
        if is_open or is_active:
            summaries.append(_public_room_summary(rid, room))
    emit("rooms_update", {"rooms": summaries})


@socketio.on("unsubscribe_lobby")
def handle_unsubscribe_lobby():
    leave_room(LOBBY_ROOM)


@socketio.on("create_room")
def handle_create_room(data):
    sid = request.sid
    mode = data.get("mode", "pvp")
    difficulty = data.get("difficulty", "medium")
    name = str(data.get("name", "Player"))[:20].strip() or "Player"
    fp_raw = data.get("first_player", "0")
    first_player = random.randint(0, 1) if fp_raw == "random" else int(fp_raw)

    token = _make_token()
    room_id = _make_room_id()
    rooms[room_id] = {
        "game": None,
        "mode": mode,
        "difficulty": difficulty,
        "players": [{"sid": sid, "player_id": 0, "name": name,
                     "token": token, "connected": True}],
        "spectators": [],
        "started": False,
        "scores": {0: 0, 1: 0},
        "games_played": 0,
        "score_recorded": False,
        "ai_task_token": 0,
        "state_seq": 0,
        "next_first_player": first_player,
        "first_player": first_player,
        "forfeit": None,
        "disconnect_tokens": {},
        "cleanup_token": None,
    }
    sid_to_room[sid] = room_id
    join_room(room_id)

    if mode == "ai":
        # AI mode: there is no second human, but we still want the AI "player" slot
        # to exist so spectators / state broadcasts make sense.
        rooms[room_id]["players"].append({
            "sid": None, "player_id": 1, "name": f"AI ({difficulty})",
            "token": None, "connected": True,
        })
        rooms[room_id]["game"] = MancalaGame(first_player=first_player)
        rooms[room_id]["next_first_player"] = 1 - first_player
        rooms[room_id]["started"] = True
        emit("joined", {
            "room_id": room_id, "player_id": 0, "mode": "ai",
            "difficulty": difficulty, "opponent": f"AI ({difficulty})",
            "first_player": first_player, "token": token,
        })
        _broadcast_state(room_id)
        if first_player == 1:
            _start_ai_task(room_id)
    else:
        emit("joined", {"room_id": room_id, "player_id": 0, "mode": "pvp", "token": token})
        emit("waiting", {"room_id": room_id})

    _broadcast_rooms_update()


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

    token = _make_token()
    room["players"].append({"sid": sid, "player_id": 1, "name": name,
                            "token": token, "connected": True})
    sid_to_room[sid] = room_id
    join_room(room_id)

    fp = room["next_first_player"]
    room["next_first_player"] = 1 - fp
    room["first_player"] = fp
    room["game"] = MancalaGame(first_player=fp)
    room["started"] = True

    p0 = room["players"][0]
    p1 = room["players"][1]

    if p0.get("sid"):
        socketio.emit("joined", {
            "room_id": room_id, "player_id": 0, "mode": "pvp", "opponent": p1["name"],
            "first_player": fp, "token": p0["token"],
        }, to=p0["sid"])
    emit("joined", {
        "room_id": room_id, "player_id": 1, "mode": "pvp", "opponent": p0["name"],
        "first_player": fp, "token": token,
    })
    _broadcast_state(room_id)
    _broadcast_rooms_update()


@socketio.on("spectate_room")
def handle_spectate(data):
    sid = request.sid
    room_id = str(data.get("room_id", "")).strip().upper()
    raw_name = str(data.get("name", "")).strip()[:20]

    room = rooms.get(room_id)
    if not room:
        emit("error", {"message": f'Room "{room_id}" not found.'})
        return
    if not room.get("started") or not room.get("game"):
        emit("error", {"message": "That game hasn't started yet."})
        return
    if room["game"].game_over:
        emit("error", {"message": "That game is already over."})
        return
    if len(room["spectators"]) >= MAX_SPECTATORS:
        emit("error", {"message": "Spectator limit reached for this room."})
        return

    name = raw_name or _next_spectator_name(room)
    token = _make_token()
    spectator = {"sid": sid, "name": name, "token": token}
    room["spectators"].append(spectator)
    sid_to_room[sid] = room_id
    join_room(room_id)

    p0 = room["players"][0] if len(room["players"]) > 0 else None
    p1 = room["players"][1] if len(room["players"]) > 1 else None

    emit("spectator_joined", {
        "room_id": room_id,
        "mode": room["mode"],
        "difficulty": room.get("difficulty"),
        "p0_name": p0["name"] if p0 else "Player 1",
        "p1_name": p1["name"] if p1 else "Player 2",
        "first_player": room.get("first_player", 0),
        "your_name": name,
        "token": token,
    })

    socketio.emit("spectator_update", {
        "spectator_count": len(room["spectators"]),
        "joined": name,
    }, to=room_id)

    _broadcast_state(room_id)
    _broadcast_rooms_update()


@socketio.on("rejoin_room")
def handle_rejoin(data):
    sid = request.sid
    room_id = str(data.get("room_id", "")).strip().upper()
    token = str(data.get("token", ""))

    room = rooms.get(room_id)
    if not room:
        emit("rejoin_failed", {"message": "Room no longer exists."})
        return

    player = _player_by_token(room, token)
    if player:
        # Drop any prior sid mapping for this player slot.
        old_sid = player.get("sid")
        if old_sid and old_sid in sid_to_room:
            sid_to_room.pop(old_sid, None)

        player["sid"] = sid
        player["connected"] = True
        sid_to_room[sid] = room_id
        join_room(room_id)

        # Invalidate the grace timer for this player.
        room.setdefault("disconnect_tokens", {})[player["player_id"]] = None

        opp = _opponent(room, player)
        if opp and opp.get("name"):
            opp_name = opp["name"]
        elif room["mode"] == "ai":
            opp_name = f"AI ({room.get('difficulty', 'medium')})"
        else:
            opp_name = "Opponent"

        emit("joined", {
            "room_id": room_id,
            "player_id": player["player_id"],
            "mode": room["mode"],
            "difficulty": room.get("difficulty"),
            "opponent": opp_name,
            "first_player": room.get("first_player", 0),
            "token": player["token"],
            "rejoin": True,
        })

        socketio.emit("opponent_reconnected", {
            "player_id": player["player_id"],
            "name": player["name"],
        }, to=room_id, skip_sid=sid)

        _broadcast_state(room_id)
        _broadcast_rooms_update()

        # If it was AI's turn when the human dropped, resume AI loop.
        if (room["mode"] == "ai" and room["game"] and not room["game"].game_over
                and room["game"].current_player == 1):
            _start_ai_task(room_id)
        return

    # Try spectator token
    spec = next((s for s in room["spectators"] if s.get("token") == token), None)
    if spec:
        old_sid = spec.get("sid")
        if old_sid and old_sid in sid_to_room:
            sid_to_room.pop(old_sid, None)
        spec["sid"] = sid
        sid_to_room[sid] = room_id
        join_room(room_id)

        p0 = room["players"][0] if len(room["players"]) > 0 else None
        p1 = room["players"][1] if len(room["players"]) > 1 else None
        emit("spectator_joined", {
            "room_id": room_id,
            "mode": room["mode"],
            "difficulty": room.get("difficulty"),
            "p0_name": p0["name"] if p0 else "Player 1",
            "p1_name": p1["name"] if p1 else "Player 2",
            "first_player": room.get("first_player", 0),
            "your_name": spec["name"],
            "token": spec["token"],
            "rejoin": True,
        })
        _broadcast_state(room_id)
        return

    emit("rejoin_failed", {"message": "Could not rejoin (session expired)."})


@socketio.on("move")
def handle_move(data):
    sid = request.sid
    room_id = sid_to_room.get(sid)
    if not room_id:
        return
    room = rooms.get(room_id)
    if not room or not room["started"] or not room["game"]:
        return

    role, person = _find_role(room, sid)
    if role != "player":
        return

    player = person["player_id"]
    pit = data.get("pit")
    if pit is None:
        return

    ok, reason = room["game"].make_move(player, int(pit))
    if not ok:
        emit("error", {"message": reason})
        return

    _broadcast_state(room_id)

    if room["game"].game_over:
        _broadcast_rooms_update()

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
    role, person = _find_role(room, sid)
    if not person:
        return
    text = str(data.get("text", ""))[:200].strip()
    if not text:
        return
    if role == "player":
        socketio.emit("chat", {
            "from": person["player_id"],
            "name": person["name"],
            "text": text,
            "role": "player",
        }, to=room_id)
    else:
        socketio.emit("chat", {
            "from": None,
            "name": person["name"],
            "text": text,
            "role": "spectator",
        }, to=room_id)


@socketio.on("rematch")
def handle_rematch():
    sid = request.sid
    room_id = sid_to_room.get(sid)
    room = rooms.get(room_id)
    if not room or not room["started"] or not room["game"]:
        return
    role, person = _find_role(room, sid)
    if role != "player":
        return
    if not room["game"].game_over:
        return
    if room["mode"] == "pvp":
        other = _opponent(room, person)
        if not other or not other.get("connected"):
            emit("error", {"message": "Cannot rematch — opponent is disconnected."})
            return

    fp = room["next_first_player"]
    room["next_first_player"] = 1 - fp
    room["first_player"] = fp
    room["game"] = MancalaGame(first_player=fp)
    room["score_recorded"] = False
    room["forfeit"] = None
    room["ai_task_token"] = room.get("ai_task_token", 0) + 1
    for p in room["players"]:
        if p.get("sid"):
            socketio.emit("new_game", {"first_player": fp}, to=p["sid"])
    for s in room["spectators"]:
        if s.get("sid"):
            socketio.emit("new_game", {"first_player": fp}, to=s["sid"])
    _broadcast_state(room_id)
    _broadcast_rooms_update()
    if room["mode"] == "ai" and room["game"].current_player == 1:
        _start_ai_task(room_id)


@socketio.on("claim_disconnect_win")
def handle_claim_win():
    sid = request.sid
    room_id = sid_to_room.get(sid)
    if not room_id:
        return
    room = rooms.get(room_id)
    if not room or not room.get("game"):
        return
    role, person = _find_role(room, sid)
    if role != "player":
        return
    opp = _opponent(room, person)
    if not opp or opp.get("connected"):
        emit("error", {"message": "Opponent is still connected."})
        return
    if room["game"].game_over:
        return
    _force_forfeit(room, winner_player_id=person["player_id"], loser_name=opp["name"])
    socketio.emit("game_forfeited", {
        "winner": person["player_id"],
        "winner_name": person["name"],
        "loser": opp["player_id"],
        "loser_name": opp["name"],
    }, to=room_id)
    _broadcast_state(room_id)
    _broadcast_rooms_update()


@socketio.on("leave_room_request")
def handle_leave_room():
    """Client explicitly leaves a room (Main Menu button).
    Players abandoning an in-progress PvP game forfeit it."""
    sid = request.sid
    room_id = sid_to_room.pop(sid, None)
    if not room_id:
        return
    room = rooms.get(room_id)
    if not room:
        return

    role, person = _find_role(room, sid)
    if person:
        person["sid"] = None
    try:
        leave_room(room_id)
    except Exception:
        pass

    if role == "spectator":
        room["spectators"] = [s for s in room["spectators"] if s is not person]
        socketio.emit("spectator_update", {
            "spectator_count": len(room["spectators"]),
            "left": person["name"] if person else None,
        }, to=room_id)
        _broadcast_rooms_update()
        return

    if role == "player":
        person["connected"] = False
        # If game is in progress in PvP, forfeit; else just close the room.
        if (room["mode"] == "pvp" and room.get("game")
                and not room["game"].game_over and room.get("started")):
            opp = _opponent(room, person)
            if opp and opp.get("connected"):
                _force_forfeit(room, winner_player_id=opp["player_id"], loser_name=person["name"])
                socketio.emit("game_forfeited", {
                    "winner": opp["player_id"],
                    "winner_name": opp["name"],
                    "loser": person["player_id"],
                    "loser_name": person["name"],
                    "reason": "left",
                }, to=room_id)
                _broadcast_state(room_id)
                _broadcast_rooms_update()
                return
        # Otherwise: nobody to wait for, close the room.
        if not any(p.get("connected") and p.get("sid") for p in room["players"]):
            _destroy_room(room_id, reason="left")
        else:
            _broadcast_rooms_update()


@socketio.on("disconnect")
def handle_disconnect():
    sid = request.sid
    room_id = sid_to_room.pop(sid, None)
    if not room_id:
        return
    room = rooms.get(room_id)
    if not room:
        return

    role, person = _find_role(room, sid)
    if role == "spectator":
        room["spectators"] = [s for s in room["spectators"] if s is not person]
        socketio.emit("spectator_update", {
            "spectator_count": len(room["spectators"]),
            "left": person["name"] if person else None,
        }, to=room_id)
        _broadcast_rooms_update()
        # Maybe nobody is left; consider cleanup.
        if (not any(p.get("connected") and p.get("sid") for p in room["players"])
                and not room["spectators"]):
            _schedule_empty_cleanup(room_id)
        return

    if role != "player":
        return

    person["connected"] = False
    person["sid"] = None

    if not room.get("started"):
        # Room never got off the ground. Destroy it.
        _destroy_room(room_id, reason="creator_left")
        return

    if room["mode"] == "ai":
        # Human dropped from an AI game. Keep the room alive briefly for rejoin
        # so they don't lose their series score by closing the tab.
        socketio.emit("opponent_disconnected", {
            "player_id": person["player_id"],
            "name": person["name"],
            "grace_seconds": DISCONNECT_GRACE_SECONDS,
        }, to=room_id)
        _schedule_grace_task(room_id, person["player_id"])
        if (not any(p.get("connected") and p.get("sid") for p in room["players"])
                and not room["spectators"]):
            _schedule_empty_cleanup(room_id)
        _broadcast_rooms_update()
        return

    # PvP disconnect:
    socketio.emit("opponent_disconnected", {
        "player_id": person["player_id"],
        "name": person["name"],
        "grace_seconds": DISCONNECT_GRACE_SECONDS,
    }, to=room_id)
    _schedule_grace_task(room_id, person["player_id"])

    if (not any(p.get("connected") and p.get("sid") for p in room["players"])
            and not room["spectators"]):
        _schedule_empty_cleanup(room_id)
    _broadcast_rooms_update()


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port, debug=False, allow_unsafe_werkzeug=True)

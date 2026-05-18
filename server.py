"""
Mancala - Server
Board indices: 0-5 (P1 pits), 6 (P1 store), 7-12 (P2 pits), 13 (P2 store).
Stones move counter-clockwise, skipping the opponent's store.
Land in your store = extra turn. Land in empty pit on your side = capture.
"""
import socket
import threading
import json
import argparse
import random
import time

INITIAL_STONES = 4
NUM_PITS = 14
P1_PITS = list(range(0, 6))
P1_STORE = 6
P2_PITS = list(range(7, 13))
P2_STORE = 13
PLAYER_PITS = {0: P1_PITS, 1: P2_PITS}
PLAYER_STORE = {0: P1_STORE, 1: P2_STORE}
# Direct opposite for capture: P1 pit i <-> P2 pit (12-i)
OPPOSITE = {i: 12 - i for i in range(0, 6)}
OPPOSITE.update({12 - i: i for i in range(0, 6)})


class MancalaGame:
    def __init__(self):
        self.board = [INITIAL_STONES] * NUM_PITS
        self.board[P1_STORE] = 0
        self.board[P2_STORE] = 0
        self.current_player = 0
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

        # Capture: last stone lands in own empty pit, opposite pit has stones
        if (idx in PLAYER_PITS[player]
                and self.board[idx] == 1
                and self.board[OPPOSITE[idx]] > 0):
            self.board[PLAYER_STORE[player]] += self.board[idx] + self.board[OPPOSITE[idx]]
            self.board[idx] = 0
            self.board[OPPOSITE[idx]] = 0

        self.last_move = {"player": player, "pit": pit_idx, "extra_turn": extra_turn}

        # End-of-game sweep
        p1_done = all(self.board[i] == 0 for i in P1_PITS)
        p2_done = all(self.board[i] == 0 for i in P2_PITS)
        if p1_done or p2_done:
            for i in P1_PITS:
                self.board[P1_STORE] += self.board[i]
                self.board[i] = 0
            for i in P2_PITS:
                self.board[P2_STORE] += self.board[i]
                self.board[i] = 0
            self.game_over = True
            s1, s2 = self.board[P1_STORE], self.board[P2_STORE]
            self.winner = 0 if s1 > s2 else (1 if s2 > s1 else None)
        elif not extra_turn:
            self.current_player = 1 - player

        return True, "OK"

    def state(self):
        return {
            "type": "state",
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


# ── AI ───────────────────────────────────────────────────────────────────────

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


# ── Server ───────────────────────────────────────────────────────────────────

class Server:
    def __init__(self, host, port, mode, difficulty):
        self.host = host
        self.port = port
        self.mode = mode
        self.difficulty = difficulty
        self.clients = []
        self.lock = threading.Lock()
        self.game = None

    @staticmethod
    def send(sock, msg):
        sock.sendall((json.dumps(msg) + "\n").encode("utf-8"))

    def broadcast_state(self):
        state = self.game.state()
        for sock, pid in self.clients:
            try:
                self.send(sock, {**state, "your_player": pid})
            except OSError:
                pass

    def _ai_turn(self):
        time.sleep(0.8)
        while True:
            with self.lock:
                if self.game.game_over or self.game.current_player != 1:
                    break
                pit = get_ai_move(self.game, self.difficulty)
                if pit is None:
                    break
                self.game.make_move(1, pit)
                self.broadcast_state()
                if self.game.game_over or self.game.current_player != 1:
                    break
            time.sleep(0.5)  # pause between consecutive AI extra-turn moves

    def handle_client(self, sock, pid):
        buf = ""
        try:
            opp = f"vs AI ({self.difficulty})" if self.mode == "ai" else "vs Player 2"
            self.send(sock, {
                "type": "welcome",
                "player": pid,
                "message": f"You are Player {pid + 1}  |  {opp}",
                "mode": self.mode,
                "difficulty": self.difficulty,
            })
            while True:
                data = sock.recv(4096).decode("utf-8")
                if not data:
                    break
                buf += data
                while "\n" in buf:
                    line, buf = buf.split("\n", 1)
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        msg = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if msg.get("type") == "move":
                        with self.lock:
                            ok, reason = self.game.make_move(pid, msg["pit"])
                            if not ok:
                                self.send(sock, {"type": "error", "message": reason})
                                continue
                            self.broadcast_state()
                            if self.game.game_over:
                                return
                            if self.mode == "ai" and self.game.current_player == 1:
                                threading.Thread(target=self._ai_turn, daemon=True).start()
                    elif msg.get("type") == "chat":
                        for s, _ in self.clients:
                            try:
                                self.send(s, {"type": "chat", "from": pid, "text": msg.get("text", "")})
                            except OSError:
                                pass
        except (ConnectionError, OSError):
            pass
        finally:
            try:
                sock.close()
            except OSError:
                pass

    def run(self):
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind((self.host, self.port))

        if self.mode == "ai":
            srv.listen(1)
            print(f"[server] Mancala  vs AI ({self.difficulty})  on {self.host}:{self.port}")
            print("[server] waiting for 1 player...")
            sock, addr = srv.accept()
            self.clients = [(sock, 0)]
            print(f"[server] Player 1 connected from {addr}")
            self.game = MancalaGame()
            t = threading.Thread(target=self.handle_client, args=(sock, 0), daemon=True)
            t.start()
            self.broadcast_state()
            t.join()
        else:
            srv.listen(2)
            print(f"[server] Mancala PvP  on {self.host}:{self.port}")
            print("[server] waiting for 2 players...")
            while len(self.clients) < 2:
                sock, addr = srv.accept()
                pid = len(self.clients)
                self.clients.append((sock, pid))
                print(f"[server] Player {pid + 1} connected from {addr}")
            self.game = MancalaGame()
            threads = [threading.Thread(target=self.handle_client, args=(s, p), daemon=True)
                       for s, p in self.clients]
            for t in threads:
                t.start()
            self.broadcast_state()
            for t in threads:
                t.join()

        if self.game:
            w = self.game.winner
            label = "AI" if (self.mode == "ai" and w == 1) else (f"Player {w + 1}" if w is not None else None)
            print(f"[server] {'Tie' if label is None else label + ' wins'}")
        srv.close()


def main():
    p = argparse.ArgumentParser(description="Mancala server")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=5556)
    p.add_argument("--mode", choices=["pvp", "ai"], default="pvp",
                   help="pvp = two humans  |  ai = vs computer  (default: pvp)")
    p.add_argument("--difficulty", choices=["easy", "medium", "hard"], default="medium",
                   help="AI difficulty — easy/medium/hard  (default: medium)")
    args = p.parse_args()
    Server(args.host, args.port, args.mode, args.difficulty).run()


if __name__ == "__main__":
    main()

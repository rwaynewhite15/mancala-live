"""
Mancala - Game constants and MancalaGame class.
Board indices: 0-5 (P1 pits), 6 (P1 store), 7-12 (P2 pits), 13 (P2 store).
"""

# ── Game constants ────────────────────────────────────────────────────────────

INITIAL_STONES = 4
NUM_PITS = 14
AI_STARTUP_DELAY = 0.8
AI_MOVE_DELAY = 0.5
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

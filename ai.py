"""
Mancala - AI logic.
"""
import random
from game import PLAYER_STORE, PLAYER_PITS


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

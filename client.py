"""
Mancala - Client
Commands:
    move <pit>   pick pit 1-6 on your side  (shortcut: m <pit>)
    chat <msg>
    quit
"""
import socket
import threading
import json
import argparse

P1_STORE = 6
P2_STORE = 13


def _pit_label(board_idx, player):
    """Convert board index to the 1-6 pit label from that player's perspective."""
    if player == 0:
        return board_idx + 1          # 0→1 … 5→6
    return 13 - board_idx             # 12→1 … 7→6


def _label_to_idx(label, player):
    """Convert 1-6 pit label to board index."""
    if player == 0:
        return label - 1              # 1→0 … 6→5
    return 13 - label                 # 1→12 … 6→7


def render_board(board, my_player):
    """Always show own pits at the bottom (labeled 1-6 left→right), store on the right."""
    if my_player == 0:
        my_pits    = [board[i] for i in range(0, 6)]           # 0..5
        opp_pits   = [board[i] for i in range(12, 6, -1)]      # 12..7
        my_store   = board[P1_STORE]
        opp_store  = board[P2_STORE]
    else:
        my_pits    = [board[i] for i in range(12, 6, -1)]      # 12..7  (P2 left→right)
        opp_pits   = [board[i] for i in range(5, -1, -1)]      # 5..0   (P1 from P2's view)
        my_store   = board[P2_STORE]
        opp_store  = board[P1_STORE]

    W = 4  # cell width

    def cell(n):
        return f" {str(n):^{W-1}}"

    bar   = "+" + ("-" * W + "+") * 6
    # opponent row: pits shown with their labels 6→1 (right to left from opponent's view)
    opp_row  = "|" + "|".join(cell(v) for v in opp_pits) + "|"
    opp_lbl  = "|" + "|".join(f"{'p'+str(6-i):^{W}}" for i in range(6)) + "|"
    my_row   = "|" + "|".join(cell(v) for v in my_pits) + "|"
    my_lbl   = "|" + "|".join(f"{'p'+str(i+1):^{W}}" for i in range(6)) + "|"

    pad = " " * 2
    lines = [
        "",
        f"  Opponent store: {opp_store}",
        f"{pad}{bar}",
        f"{pad}{opp_row}   (opponent)",
        f"{pad}{opp_lbl}",
        f"{pad}{bar}",
        f"{pad}{my_row}   (you)",
        f"{pad}{my_lbl}",
        f"{pad}{bar}",
        f"  Your store: {my_store}",
        "",
    ]
    return "\n".join(lines)


class Client:
    def __init__(self, host, port):
        self.host = host
        self.port = port
        self.sock = None
        self.player_id = None
        self.mode = "pvp"
        self.difficulty = ""
        self.running = True

    def send(self, msg):
        self.sock.sendall((json.dumps(msg) + "\n").encode("utf-8"))

    def display(self, state):
        my = self.player_id if self.player_id is not None else 0
        print(render_board(state["board"], my))

        last = state.get("last_move")
        if last:
            who = "You" if last["player"] == my else ("AI" if self.mode == "ai" else f"Player {last['player']+1}")
            label = _pit_label(last["pit"], last["player"])
            extra = "  (extra turn!)" if last["extra_turn"] else ""
            print(f"  Last move: {who} chose pit {label}{extra}")

        if state.get("game_over"):
            board = state["board"]
            my_score  = board[P1_STORE if my == 0 else P2_STORE]
            opp_score = board[P2_STORE if my == 0 else P1_STORE]
            print(f"\n  Final score — You: {my_score}  |  Opponent: {opp_score}")
            winner = state.get("winner")
            if winner is None:
                print("\n  *** TIE GAME ***\n")
            elif winner == my:
                print("\n  *** YOU WIN! ***\n")
            else:
                print("\n  *** YOU LOSE ***\n")
        else:
            cp = state["current_player"]
            vm = state.get("valid_moves", [])
            if cp == my:
                labels = sorted(_pit_label(i, my) for i in vm)
                print(f"\n  >>> your turn <<<   valid pits: {', '.join(str(l) for l in labels)}")
            else:
                opp_name = "AI" if self.mode == "ai" else f"Player {cp + 1}"
                print(f"\n  ... waiting for {opp_name} ...")

    def receive_loop(self):
        buf = ""
        try:
            while self.running:
                data = self.sock.recv(4096).decode("utf-8")
                if not data:
                    break
                buf += data
                while "\n" in buf:
                    line, buf = buf.split("\n", 1)
                    if not line.strip():
                        continue
                    msg = json.loads(line)
                    t = msg.get("type")
                    if t == "welcome":
                        self.player_id = msg["player"]
                        self.mode = msg.get("mode", "pvp")
                        self.difficulty = msg.get("difficulty", "")
                        print(f"\n[ {msg['message']} ]\n")
                    elif t == "state":
                        self.display(msg)
                        if msg.get("game_over"):
                            self.running = False
                            return
                    elif t == "chat":
                        who = f"Player {msg['from'] + 1}"
                        print(f"\n  [{who}]: {msg['text']}")
                    elif t == "error":
                        print(f"\n  [!] {msg['message']}")
        except (ConnectionError, OSError, json.JSONDecodeError):
            pass
        finally:
            self.running = False
            print("\n[ disconnected ]")

    def input_loop(self):
        print("Commands:  'm <pit 1-6>'   'chat <msg>'   'quit'\n")
        while self.running:
            try:
                line = input().strip()
            except EOFError:
                break
            if not line:
                continue
            parts = line.split(maxsplit=2)
            cmd = parts[0].lower()
            if cmd in ("quit", "q", "exit"):
                self.running = False
                break
            if cmd in ("move", "m"):
                if len(parts) < 2:
                    print("usage: m <pit 1-6>")
                    continue
                try:
                    label = int(parts[1])
                except ValueError:
                    print("number required")
                    continue
                if not (1 <= label <= 6):
                    print("pit must be 1-6")
                    continue
                pit_idx = _label_to_idx(label, self.player_id or 0)
                self.send({"type": "move", "pit": pit_idx})
            elif cmd == "chat":
                self.send({"type": "chat", "text": line[5:].strip()})
            else:
                print("unknown command  (m <pit>  |  chat <msg>  |  quit)")

    def run(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.connect((self.host, self.port))
        print(f"[ connected to {self.host}:{self.port} ]")
        t = threading.Thread(target=self.receive_loop, daemon=True)
        t.start()
        try:
            self.input_loop()
        except KeyboardInterrupt:
            pass
        finally:
            try:
                self.sock.close()
            except OSError:
                pass


def main():
    p = argparse.ArgumentParser(description="Mancala client")
    p.add_argument("--host", default="localhost")
    p.add_argument("--port", type=int, default=5556)
    args = p.parse_args()
    Client(args.host, args.port).run()


if __name__ == "__main__":
    main()

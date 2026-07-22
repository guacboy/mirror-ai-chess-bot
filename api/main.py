import sys
import asyncio
import io
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import chess
import chess.engine
import chess.pgn
import torch
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from dotenv import load_dotenv

from agent.encoder import board_to_tensor
from agent.model import ChessNet, encode_move
from agent.game import get_epsilon, get_bot_move, load_experiences, save_experiences
from agent.trainer import train, save_model, load_model


load_dotenv()

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Using device: {device}")

model = ChessNet().to(device)
load_model(model, device)

_executor = ThreadPoolExecutor(max_workers=1)

sf_engine: chess.engine.SimpleEngine | None = None
_sf_dir = Path(__file__).parent / "stockfish"
if _sf_dir.exists():
    _exes = list(_sf_dir.glob("*.exe"))
    if _exes:
        try:
            sf_engine = chess.engine.SimpleEngine.popen_uci(str(_exes[0]))
            print(f"Stockfish loaded: {_exes[0].name}")
        except Exception as e:
            print(f"Stockfish not available: {e}")

# Persist games-played count so epsilon decay survives restarts.
_COUNTER_PATH = Path(__file__).parent.parent / "src" / "data" / "games_played.txt"


def _load_games_played() -> int:
    if _COUNTER_PATH.exists():
        return int(_COUNTER_PATH.read_text().strip())
    return 0


def _save_games_played(n: int) -> None:
    _COUNTER_PATH.parent.mkdir(exist_ok=True)
    _COUNTER_PATH.write_text(str(n))


games_played = _load_games_played()

# Persist Stockfish difficulty settings across restarts.
_SF_SETTINGS_PATH = Path(__file__).parent.parent / "src" / "data" / "stockfish_settings.json"


def _load_sf_settings() -> dict:
    if _SF_SETTINGS_PATH.exists():
        try:
            return json.loads(_SF_SETTINGS_PATH.read_text())
        except Exception:
            pass
    return {"level": 10, "auto": True}


def _save_sf_settings(settings: dict) -> None:
    _SF_SETTINGS_PATH.parent.mkdir(exist_ok=True)
    _SF_SETTINGS_PATH.write_text(json.dumps(settings))


_sf_settings = _load_sf_settings()
sf_skill_level: int = int(_sf_settings.get("level", 10))
sf_auto_adjust: bool = bool(_sf_settings.get("auto", True))

PIECE_NAMES = {
    chess.PAWN: "Pawn", chess.KNIGHT: "Knight", chess.BISHOP: "Bishop",
    chess.ROOK: "Rook", chess.QUEEN: "Queen", chess.KING: "King",
}


def _format_move(board: chess.Board, move: chess.Move) -> str:
    piece = board.piece_at(move.from_square)
    name = PIECE_NAMES.get(piece.piece_type, "?") if piece else "?"
    return f"[{board.fullmove_number}] {name} {chess.square_name(move.from_square)} → {chess.square_name(move.to_square)}"


def _get_outcome(winner: str | None, user_color: chess.Color) -> float:
    if winner == "white":
        return 1.0 if user_color == chess.WHITE else -1.0
    if winner == "black":
        return 1.0 if user_color == chess.BLACK else -1.0
    return 0.0


def _run_training(new_experiences: list) -> None:
    global games_played
    all_exp = save_experiences(new_experiences)
    games_played += 1
    _save_games_played(games_played)
    print(f"\nSaved {len(new_experiences)} new moves. Total dataset: {len(all_exp)} moves.")
    train(model, device, all_exp)
    save_model(model)


def _increment_games_played() -> None:
    global games_played
    games_played += 1
    _save_games_played(games_played)


def _update_sf_settings(level: int, auto: bool) -> None:
    global sf_skill_level, sf_auto_adjust
    sf_skill_level = level
    sf_auto_adjust = auto
    _save_sf_settings({"level": level, "auto": auto})
    print(f"Stockfish settings updated: level={level}, auto={auto}")


def _auto_adjust_sf(result: str) -> None:
    global sf_skill_level
    if not sf_auto_adjust:
        return
    if result == "win":
        sf_skill_level = min(20, sf_skill_level + 1)
    elif result == "lose":
        sf_skill_level = max(0, sf_skill_level - 1)
    else:
        return
    _save_sf_settings({"level": sf_skill_level, "auto": sf_auto_adjust})
    print(f"Stockfish skill auto-adjusted to {sf_skill_level}")


def _reset_model_and_counter() -> None:
    global games_played
    from agent.model import ChessNet
    from agent.trainer import clear_model
    from agent.game import clear_experiences
    new_net = ChessNet().to(device)
    model.load_state_dict(new_net.state_dict())
    clear_model()
    clear_experiences()
    games_played = 0
    _save_games_played(0)
    print("Model and training data reset.")


def _run_import(pgn_text: str) -> int:
    pgn_io = io.StringIO(pgn_text)
    experiences: list[tuple] = []
    games_count = 0
    while True:
        game = chess.pgn.read_game(pgn_io)
        if game is None:
            break
        result = game.headers.get("Result", "*")
        board = game.board()
        for move in game.mainline_moves():
            outcome = (
                (1.0 if board.turn == chess.WHITE else -1.0) if result == "1-0" else
                (-1.0 if board.turn == chess.WHITE else 1.0) if result == "0-1" else
                0.0
            )
            experiences.append((board_to_tensor(board), encode_move(move), outcome))
            board.push(move)
        games_count += 1
    if experiences:
        all_exp = save_experiences(experiences)
        print(f"\nImported {len(experiences)} moves from {games_count} games. Dataset: {len(all_exp)} total.")
        train(model, device, all_exp)
        save_model(model)
    return games_count


app = FastAPI()

# Allow the Vite dev server (port 5173) to reach the API during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_web_build = Path(__file__).parent.parent / "web" / "dist"


@app.websocket("/ws")
async def game_ws(ws: WebSocket) -> None:
    await ws.accept()

    board: chess.Board = chess.Board()
    user_color: chess.Color = chess.WHITE
    user_records: list[tuple[torch.Tensor, int]] = []
    move_log: list[str] = []
    move_counts = {"model": 0, "stockfish": 0, "random": 0}

    async def send(payload: dict) -> None:
        await ws.send_text(json.dumps(payload))

    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)

            # start: user picks a color and starts a new game.
            if msg["type"] == "start":
                color_str = msg.get("color", "white")
                user_color = chess.WHITE if color_str == "white" else chess.BLACK
                board = chess.Board()
                user_records = []
                move_log = []
                move_counts = {"model": 0, "stockfish": 0, "random": 0}
                epsilon = get_epsilon(games_played)

                await send({
                    "type": "game_started",
                    "fen": board.fen(),
                    "user_color": color_str,
                    "epsilon": round(epsilon, 2),
                    "model_pct": round((1 - epsilon) * 100),
                    "games_played": games_played,
                    "sf_skill": sf_skill_level,
                    "sf_auto": sf_auto_adjust,
                })

                # If bot goes first (user is black), send bot's opening move.
                bot_color = chess.BLACK if user_color == chess.WHITE else chess.WHITE
                if board.turn == bot_color:
                    move, source = get_bot_move(board, model, device, epsilon, sf_engine, sf_skill_level)
                    desc = _format_move(board, move)
                    board.push(move)
                    move_counts[source] += 1
                    move_log.append(f"Bot: {desc}  [{source}]")
                    await send({
                        "type": "bot_move",
                        "uci": move.uci(),
                        "fen": board.fen(),
                        "description": desc,
                        "source": source,
                    })

            # move: user plays a move.
            elif msg["type"] == "move":
                uci = msg.get("uci", "")
                try:
                    user_move = chess.Move.from_uci(uci)
                except ValueError:
                    await send({"type": "error", "message": f"Invalid UCI: {uci}"})
                    continue

                if user_move not in board.legal_moves:
                    await send({"type": "error", "message": "Illegal move."})
                    continue

                # Record the user's move for training.
                user_records.append((board_to_tensor(board), encode_move(user_move)))
                desc = _format_move(board, user_move)
                board.push(user_move)
                move_log.append(f"You: {desc}")

                await send({
                    "type": "user_move_ack",
                    "fen": board.fen(),
                    "description": desc,
                })

                # Check if game ended after user's move.
                if board.is_game_over():
                    result = board.result()  # "1-0", "0-1", "1/2-1/2"
                    winner_color = (
                        "white" if result == "1-0" else
                        "black" if result == "0-1" else
                        None
                    )
                    outcome = _get_outcome(winner_color, user_color)
                    label = "win" if outcome == 1.0 else "lose" if outcome == -1.0 else "draw"

                    await send({
                        "type": "game_over",
                        "result": label,
                        "move_log": move_log,
                        "move_counts": move_counts,
                    })

                    if user_records:
                        exp = [(t, idx, outcome) for t, idx in user_records]
                        loop = asyncio.get_event_loop()
                        await loop.run_in_executor(_executor, _run_training, exp)
                        await send({"type": "training_complete"})
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(_executor, _auto_adjust_sf, label)
                    continue

                # Bot's turn.
                epsilon = get_epsilon(games_played)
                bot_color = chess.BLACK if user_color == chess.WHITE else chess.WHITE
                move, source = get_bot_move(board, model, device, epsilon, sf_engine, sf_skill_level)
                desc = _format_move(board, move)
                board.push(move)
                move_counts[source] += 1
                move_log.append(f"Bot: {desc}  [{source}]")

                await send({
                    "type": "bot_move",
                    "uci": move.uci(),
                    "fen": board.fen(),
                    "description": desc,
                    "source": source,
                })

                # Check if game ended after bot's move.
                if board.is_game_over():
                    result = board.result()
                    winner_color = (
                        "white" if result == "1-0" else
                        "black" if result == "0-1" else
                        None
                    )
                    outcome = _get_outcome(winner_color, user_color)
                    label = "win" if outcome == 1.0 else "lose" if outcome == -1.0 else "draw"

                    await send({
                        "type": "game_over",
                        "result": label,
                        "move_log": move_log,
                        "move_counts": move_counts,
                    })

                    if user_records:
                        exp = [(t, idx, outcome) for t, idx in user_records]
                        loop = asyncio.get_event_loop()
                        await loop.run_in_executor(_executor, _run_training, exp)
                        await send({"type": "training_complete"})
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(_executor, _auto_adjust_sf, label)

            # resign: user forfeits; train on their moves with a loss outcome.
            elif msg["type"] == "resign":
                if user_records:
                    exp = [(t, idx, -1.0) for t, idx in user_records]
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(_executor, _run_training, exp)
                    await send({"type": "training_complete"})
                else:
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(_executor, _increment_games_played)
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(_executor, _auto_adjust_sf, "lose")

            # abort: game cancelled early; count the game but don't train.
            elif msg["type"] == "abort":
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(_executor, _increment_games_played)

            # set_stockfish: update skill level and/or auto-adjust setting.
            elif msg["type"] == "set_stockfish":
                level = max(0, min(20, int(msg.get("level", sf_skill_level))))
                auto = bool(msg.get("auto", sf_auto_adjust))
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(_executor, _update_sf_settings, level, auto)

            # reset_model: wipe learned weights and restart the counter.
            elif msg["type"] == "reset_model":
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(_executor, _reset_model_and_counter)

            # import_games: parse a PGN string and train on the imported games.
            elif msg["type"] == "import_games":
                pgn_text = msg.get("pgn", "")
                loop = asyncio.get_event_loop()
                games_count = await loop.run_in_executor(_executor, _run_import, pgn_text)
                await send({"type": "import_complete", "games": games_count})

    except WebSocketDisconnect:
        pass


# Serve React build if it exists (production mode).
if _web_build.exists():
    app.mount("/assets", StaticFiles(directory=str(_web_build / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        return FileResponse(str(_web_build / "index.html"))

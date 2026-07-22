import chess
import chess.engine
import random
import torch
from pathlib import Path

from agent.encoder import board_to_tensor
from agent.model import ChessNet, select_move

DATA_PATH = Path(__file__).parent.parent / "data" / "games.pt"

MIN_EPSILON = 0.05
EPSILON_DECAY = 0.05


def get_epsilon(games_played: int) -> float:
    """
    Returns the current exploration rate.
    """
    return max(MIN_EPSILON, 1.0 - games_played * EPSILON_DECAY)


def get_bot_move(
    board: chess.Board,
    model: ChessNet,
    device: torch.device,
    epsilon: float,
    sf_engine: chess.engine.SimpleEngine | None = None,
    sf_skill: int = 10,
) -> tuple[chess.Move, str]:
    """
    Picks the bot's next move and reports where it came from.

    Returns (move, source) where source is one of:
        "model"      - the trained model predicted this as the user's move
        "stockfish"  - Stockfish's best move (used while model is still learning)
        "random"     - fallback if Stockfish is unavailable

    Epsilon controls the mix:
        High epsilon -> Stockfish   (early games, model untrained)
        Low epsilon  -> model       (later games, model has learned user style)

    sf_skill controls Stockfish's strength (0 = weakest, 20 = full strength).
    """
    use_model = random.random() >= epsilon

    if use_model:
        return select_move(model, board, board_to_tensor(board), device), "model"

    # Epsilon triggered; use Stockfish as the strong-play fallback.
    if sf_engine is not None:
        try:
            sf_engine.configure({"Skill Level": sf_skill})
            result = sf_engine.play(board, chess.engine.Limit(time=0.1))
            return result.move, "stockfish"
        except Exception:
            pass

    return random.choice(list(board.legal_moves)), "random"


def load_experiences() -> list[tuple[torch.Tensor, int, float]]:
    """
    Loads all saved game experience from disk.
    Returns empty list if none exists.
    """
    if DATA_PATH.exists():
        return torch.load(DATA_PATH, weights_only=False)
    return []


def save_experiences(
    new_experiences: list[tuple[torch.Tensor, int, float]],
) -> list[tuple[torch.Tensor, int, float]]:
    """
    Appends new experiences to the existing dataset and saves everything to disk.
    Returns the full combined dataset.
    """
    all_experiences = load_experiences() + new_experiences
    DATA_PATH.parent.mkdir(exist_ok=True)
    torch.save(all_experiences, DATA_PATH)
    return all_experiences


def clear_experiences() -> None:
    """
    Deletes all saved game experience, wiping the training dataset.
    Model weights are NOT affected - only the collected game data is wiped.
    """
    if DATA_PATH.exists():
        DATA_PATH.unlink()
        print("Training data cleared. Dataset will rebuild from the next game.")
    else:
        print("No training data found - nothing to clear.")

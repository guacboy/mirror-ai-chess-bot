# Mirror AI Chess Bot

A chess bot that learns your playstyle and plays it back against you. The idea is that you are essentially **playing against yourself** - the bot observes your moves, learns your tendencies, and gradually mirrors them back at you to help you identify recurring patterns and mistakes.

## How it works

The bot starts by playing Stockfish's best move in every position. As you play more games, it shifts away from Stockfish and increasingly plays moves predicted by a neural network trained exclusively on **your** moves. By game 19, the bot plays your style 95% of the time.

**Learning signal:** After each game (including resignations), every move you played is weighted by the outcome:
- Win  -> those moves get reinforced
- Loss -> those moves get discouraged
- Draw -> ignored

Over time the bot learns not just your style, but your *winning* style.

## Features

- **Color selection** - play as white or black each session; Play Again automatically switches sides
- **Resign / Abort** - resign after 3+ moves (counts as a loss) or abort early (no record penalty); both trigger the loss animation and offer Play Again
- **Move history** - click any move in the log or use the arrow keys to replay the game
- **Win / Loss / Draw record** - persisted in localStorage across sessions
- **Sound effects** - distinct audio for move, capture, castle, promotion, check, illegal move attempt, and game end
- **Settings modal**
  - *Import Games* - load a PGN file to pre-train the bot on your historical games
  - *Stockfish Level* - manually set difficulty from 0 (easiest) to 20 (full strength)
  - *Auto-adjust* - toggle to let the difficulty rise/fall automatically based on your results (win → +1, loss → −1)
  - *Reset Model* - wipe the bot's learned weights and start fresh
  - *Reset W/L Stats* - clear your win/loss/draw record
- **Bot detail panel** - click "more detail" in the status box to see games learned from, current Stockfish level, and the expected model/Stockfish breakdown; updates live when difficulty changes

## Algorithm

### Model architecture - Feedforward Neural Network (MLP)

The model is a **Multi-Layer Perceptron** built in PyTorch with ~1.84 million trainable parameters.

**Input - board encoding (773 numbers)**

Every chess position is converted into a flat vector of 773 floating-point numbers:
- 12 binary 8x8 grids - one per piece type per color (pawn, knight, bishop, rook, queen, king x white/black). Each cell is `1.0` if that piece occupies that square, `0.0` otherwise.
- 1 value for whose turn it is (`1.0` = white, `0.0` = black)
- 4 values for castling rights (one per right, `1.0` or `0.0`)

**Network layers**

```
Input       773  numbers  (board state)
    |  Linear + ReLU
    v
Layer 1     512  neurons
    |  Linear + ReLU
    v
Layer 2     512  neurons
    |  Linear + ReLU
    v
Layer 3     256  neurons
    |  Linear
    v
Output     4096  numbers  (one score per possible from -> to move)
```

**Output - move selection**

The 4096 output scores cover every possible from-square/to-square combination (64 x 64). Before selecting a move, all illegal moves are masked to `-inf` and softmax is applied so the remaining scores sum to 1.0. The move with the highest probability is played.

### Learning algorithm - Outcome-Weighted Behavioural Cloning

The training approach combines two ideas:

**1. Behavioural cloning (supervised learning)**
The model is trained to predict *your* moves. For each position you faced, it is shown the board state and asked to assign high probability to the move you actually played. You are the teacher; your moves are the labels.

**2. Outcome weighting**
Pure behavioural cloning would copy your blunders just as readily as your good moves. Outcome weighting fixes this by scaling each training example by the game result:

| Outcome | Weight | Effect |
|---------|--------|--------|
| Win | +1.0 | Reinforce these moves - play them more |
| Draw | 0.0 | Ignore - no gradient update |
| Loss | −1.0 | Discourage these moves - play them less |

**Loss function**

For each move in a batch:
```
loss = −log_prob(move_played) x outcome
```

Averaged across the batch and minimised by the **Adam optimiser** (learning rate 0.001).

- When outcome is +1.0: the model is penalised for giving the move low probability -> it learns to favour that move.
- When outcome is −1.0: the gradient is inverted -> the model is pushed *away* from that move.
- When outcome is 0.0: no gradient, no change.

**Training schedule**

After every completed game or resignation, the full accumulated dataset is shuffled and trained for 5 epochs in batches of 64. Every new game causes the model to re-learn from all historical games, not just the most recent one. Aborted games increment the game counter without triggering training.

## Requirements

- Python 3.10+
- Node.js 18+ (for building the frontend)
- NVIDIA GPU (recommended) or CPU
- [Stockfish](https://stockfishchess.org/download/) binary

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/guacboy/mirror-ai-chess-bot.git
cd mirror-ai-chess-bot
```

### 2. Create and activate a virtual environment

```bash
python -m venv venv

# Windows
venv/Scripts/activate

# macOS / Linux
source venv/bin/activate
```

### 3. Install PyTorch (GPU)

```bash
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
```

For CPU-only, omit the `--index-url` flag.

### 4. Install remaining dependencies

```bash
pip install -r requirements.txt
```

### 5. Download Stockfish

1. Download the Windows binary from [stockfishchess.org/download](https://stockfishchess.org/download/)
2. Extract and place the `.exe` inside `api/stockfish/`

```
api/stockfish/stockfish-windows-x86-64-avx2.exe
```

The bot auto-detects any `.exe` in that folder at startup.

### 6. Build the frontend

```bash
cd web
npm install
npm run build
cd ..
```

This produces `web/dist/`, which the server serves automatically in production.

### 7. Run

```bash
python src/agent/main.py
```

Then open [http://localhost:8000](http://localhost:8000) in your browser.

### Development mode

Run the backend and frontend in separate terminals:

```bash
# Terminal 1 - Python server
python src/agent/main.py

# Terminal 2 - Vite dev server
cd web
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173). The React app connects directly to the FastAPI WebSocket at port 8000.

## Resetting

**In-game:** open Settings (during a game) to reset the model or your W/L stats without leaving the browser.

**CLI:** stop the server and run one of:

```bash
# Wipe learned weights only (bot relearns from your existing game data)
python src/agent/main.py --reset-model

# Wipe game data only (if your playstyle has changed significantly)
python src/agent/main.py --reset-data

# Full reset - start completely fresh
python src/agent/main.py --reset-all
```

## Persistent data

All model data survives server restarts. Three files are written to `src/data/`:

| File | Contents |
|------|----------|
| `model.pt` | Learned neural network weights |
| `games.pt` | Every move you've ever played, with its outcome |
| `games_played.txt` | Game count used for epsilon decay |
| `stockfish_settings.json` | Stockfish skill level and auto-adjust toggle |

Refreshing the browser has no effect on any of these. They are only removed by the `--reset-*` flags or the in-game Settings modal.

## Project structure

```
mirror-ai-chess-bot/
├── api/
│   ├── main.py          # FastAPI server - WebSocket game loop, training trigger
│   ├── __init__.py
│   └── stockfish/       # Place Stockfish .exe here (gitignored)
├── src/
│   ├── agent/
│   │   ├── encoder.py   # Converts board position into a tensor (773 numbers)
│   │   ├── model.py     # Neural network (773 -> 4096 move scores)
│   │   ├── trainer.py   # Trains model on game data, saves/loads weights
│   │   ├── game.py      # Epsilon decay, bot move selection, data persistence
│   │   └── main.py      # Entry point and CLI flags (--reset-model, --reset-data, --reset-all)
│   └── data/            # Persistent model and game data (gitignored)
│       ├── model.pt
│       ├── games.pt
│       ├── games_played.txt
│       └── stockfish_settings.json
├── web/
│   ├── public/
│   │   └── sounds/      # Sound effect .mp3 files
│   ├── src/
│   │   ├── App.jsx                      # Root component - WebSocket logic, game state
│   │   └── components/
│   │       ├── Board.jsx                # Interactive chess board (react-chessboard)
│   │       ├── GameControls.jsx         # Settings, Resign/Abort, Play Again, nav buttons
│   │       ├── MoveLog.jsx              # Scrollable, clickable move history panel
│   │       ├── Record.jsx               # Win/loss/draw counter (localStorage)
│   │       ├── SettingsModal.jsx        # Settings popup (import PGN, Stockfish difficulty, reset model/stats)
│   │       └── Status.jsx               # Status message with collapsible bot detail panel
│   ├── index.html
│   └── vite.config.js
└── requirements.txt
```

## Bot behaviour over time

| Game | Stockfish | Learned style |
|------|-----------|---------------|
| 0    | 100%      | 0%            |
| 5    | 75%       | 25%           |
| 10   | 50%       | 50%           |
| 15   | 25%       | 75%           |
| 19+  | 5%        | 95%           |

To reach minimum Stockfish usage faster or slower, adjust `EPSILON_DECAY` in [src/agent/game.py](src/agent/game.py).

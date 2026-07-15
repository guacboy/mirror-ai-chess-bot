import { useState, useRef, useCallback, useEffect } from "react";
import { Chess } from "chess.js";
import Board from "./components/Board";
import GameControls from "./components/GameControls";
import MoveLog from "./components/MoveLog";
import Record from "./components/Record";
import SettingsModal from "./components/SettingsModal";
import Status from "./components/Status";

const WS_URL = import.meta.env.PROD
    ? `ws://${window.location.host}/ws`
    : "ws://localhost:8000/ws";

const RECORD_KEY = "chess-record";

function loadRecord() {
    try {
        const saved = JSON.parse(localStorage.getItem(RECORD_KEY));
        if (saved) return { wins: 0, losses: 0, draws: 0, ...saved };
    } catch { /* ignore malformed storage */ }
    return { wins: 0, losses: 0, draws: 0 };
}

// TODO(feat): stockfish auto-adjusts its rating based on user's skill level
// TODO(feat): add a small "more detail" button in the message box to show detailed information regarding bot
// TODO(bug): bot message not updating accurately (check if model is being tracked properly)

// Identifies the sound to play for a bot move by matching legal moves against the resulting FEN.
function getBotMoveSound(game, newFen) {
    const newBoard = newFen.split(" ")[0];
    for (const m of game.moves({ verbose: true })) {
        const tmp = new Chess(game.fen());
        tmp.move(m);
        if (tmp.fen().split(" ")[0] === newBoard) {
            if (m.flags.includes("p")) return "promote";
            if (m.flags.includes("k") || m.flags.includes("q")) return "castle";
            if (m.flags.includes("c") || m.flags.includes("e")) return "capture";
            return "move";
        }
    }
    return "move";
}


export default function App() {
    // phase controls which screen is shown:
    //   "setup"   -> color picker before the game starts.
    //   "playing" -> active game, board accepts moves.
    //   "over"    -> game finished, board is locked, Play Again button appears.
    const [phase, setPhase] = useState("setup");

    // Renders the chessboard starting position.
    const [fen, setFen] = useState("start");

    const [userColor, setUserColor] = useState("white");
    const [moveLog, setMoveLog] = useState([]);
    const [status, setStatus] = useState("");
    const [fenHistory, setFenHistory] = useState([]);
    const [viewIndex, setViewIndex] = useState(null);
    const [record, setRecord] = useState(loadRecord);
    const [gameResult, setGameResult] = useState(null); // "win" | "lose" | "draw" | null
    const [showSettings, setShowSettings] = useState(false);

    const wsRef = useRef(null);
    const soundsRef = useRef({
        move: new Audio("/sounds/move.mp3"),
        capture: new Audio("/sounds/capture.mp3"),
        castle: new Audio("/sounds/castle.mp3"),
        promote: new Audio("/sounds/promote.mp3"),
        moveCheck: new Audio("/sounds/move-check.mp3"),
        illegal: new Audio("/sounds/illegal.mp3"),
        gameEnd: new Audio("/sounds/game-end.mp3"),
    });

    // Used to validate moves client-side before sending them,
    // so illegal moves are rejected immediately without a round-trip to the server.
    const gameRef = useRef(new Chess());

    // Called when the user clicks "Play as White/Black".
    // Opens the WebSocket connection and registers all message handlers.
    const startGame = useCallback((color) => {
        setUserColor(color);

        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        // Once the connection is open, tell the server which color we want.
        ws.onopen = () => {
            ws.send(JSON.stringify({ type: "start", color }));
        };

        // Handle every message the server sends back.
        ws.onmessage = (e) => {
            const msg = JSON.parse(e.data);

            // Server confirmed the game started; reset local state and go to playing phase.
            if (msg.type === "game_started") {
                gameRef.current = new Chess();
                setFen(msg.fen);
                setFenHistory([msg.fen]);
                setViewIndex(null);
                setMoveLog([]);
                setStatus(
                    `Game started - you are ${color}. Bot mirrors your style ${msg.model_pct}% of the time.`
                );
                setPhase("playing");
            }

            // Server acknowledged our move; update the board to the new position.
            if (msg.type === "user_move_ack") {
                gameRef.current.load(msg.fen);
                setFen(msg.fen);
                setMoveLog((prev) => [...prev, { by: "you", text: msg.description }]);
            }

            // Server sent the bot's reply move; update the board again.
            if (msg.type === "bot_move") {
                const sound = getBotMoveSound(gameRef.current, msg.fen);
                gameRef.current.load(msg.fen);
                setFen(msg.fen);
                setMoveLog((prev) => [
                    ...prev,
                    { by: "bot", text: `${msg.description}  [${msg.source}]` },
                ]);
                setFenHistory((prev) => [...prev, msg.fen]);
                const inCheck = gameRef.current.inCheck();
                const actualSound = sound === "promote" ? "promote" : inCheck ? "moveCheck" : sound;
                soundsRef.current[actualSound].currentTime = 0;
                soundsRef.current[actualSound].play().catch(() => { });
            }

            // Game ended: show the result and a breakdown of how the bot played.
            if (msg.type === "game_over") {
                const labels = { win: "You won!", lose: "You lost.", draw: "Draw." };
                const { model: m = 0, stockfish: sf = 0, random: r = 0 } = msg.move_counts;
                const total = m + sf + r;
                const mPct = total > 0 ? Math.round((m / total) * 100) : 0;
                const sfPct = total > 0 ? Math.round((sf / total) * 100) : 0;
                setStatus(
                    `${labels[msg.result] ?? msg.result}  ·  Bot used your style ${mPct}%, Stockfish ${sfPct}%`
                );
                setPhase("over");
                setGameResult(msg.result);
                soundsRef.current.gameEnd.currentTime = 0;
                soundsRef.current.gameEnd.play().catch(() => { });
                setRecord((prev) => {
                    const next = {
                        wins: prev.wins + (msg.result === "win" ? 1 : 0),
                        losses: prev.losses + (msg.result === "lose" ? 1 : 0),
                        draws: prev.draws + (msg.result === "draw" ? 1 : 0),
                    };
                    localStorage.setItem(RECORD_KEY, JSON.stringify(next));
                    return next;
                });
            }

            // Training finished in the background after the game; append a note to status.
            if (msg.type === "training_complete") {
                setStatus((prev) => prev + "  ·  Model updated.");
            }

            if (msg.type === "error") {
                console.warn("Server error:", msg.message);
            }
        };

        ws.onerror = () => setStatus("Connection error - is the server running?");
    }, []);

    // Called by the Board component when the user drags a piece.
    // Returns true to confirm the move visually, false to snap the piece back.
    const handleMove = useCallback((sourceSquare, targetSquare) => {
        // Check legality locally before sending to the server.
        const moves = gameRef.current.moves({ verbose: true });
        const match = moves.find(
            (m) => m.from === sourceSquare && m.to === targetSquare
        );
        if (!match) return false;

        // Apply the move immediately so the board updates visually right away.
        gameRef.current.move(match);
        const newFen = gameRef.current.fen();
        setFen(newFen);
        setFenHistory((prev) => [...prev, newFen]);

        const inCheck = gameRef.current.inCheck();
        const sound = match.flags.includes("p")
            ? "promote"
            : inCheck
                ? "moveCheck"
                : match.flags.includes("k") || match.flags.includes("q")
                    ? "castle"
                    : match.flags.includes("c") || match.flags.includes("e")
                        ? "capture"
                        : "move";
        soundsRef.current[sound].currentTime = 0;
        soundsRef.current[sound].play().catch(() => { });

        // Always promote to queen.
        const uci = match.promotion
            ? `${sourceSquare}${targetSquare}q`
            : `${sourceSquare}${targetSquare}`;

        wsRef.current?.send(JSON.stringify({ type: "move", uci }));
        return true;
    }, []);

    const handlePlayAgain = () => {
        const nextColor = userColor === "white" ? "black" : "white";
        wsRef.current?.close();
        gameRef.current = new Chess();
        setFen(gameRef.current.fen());
        setMoveLog([]);
        setStatus("");
        setFenHistory([]);
        setViewIndex(null);
        setGameResult(null);
        startGame(nextColor);
    };

    const handleSettings = () => setShowSettings(true);

    const handleResetStats = () => {
        const reset = { wins: 0, losses: 0, draws: 0 };
        localStorage.setItem(RECORD_KEY, JSON.stringify(reset));
        setRecord(reset);
        setShowSettings(false);
    };

    const handleResetModel = () => {
        wsRef.current?.send(JSON.stringify({ type: "reset_model" }));
        setStatus(`Game started - you are ${userColor}. Bot mirrors your style 0% of the time.`);
        setShowSettings(false);
    };

    const handleImportGames = (file) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            wsRef.current?.send(JSON.stringify({ type: "import_games", pgn: e.target.result }));
        };
        reader.readAsText(file);
        setShowSettings(false);
    };
    const canAbort = fenHistory.length - 1 < 3;
    const handleQuit = () => {
        wsRef.current?.send(JSON.stringify({ type: canAbort ? "abort" : "resign" }));
        wsRef.current?.close();
        setPhase("over");
        setGameResult("lose");
        setStatus(canAbort ? "Game aborted." : "You resigned.");
        if (!canAbort) {
            setRecord((prev) => {
                const next = { ...prev, losses: prev.losses + 1 };
                localStorage.setItem(RECORD_KEY, JSON.stringify(next));
                return next;
            });
        }
        soundsRef.current.gameEnd.currentTime = 0;
        soundsRef.current.gameEnd.play().catch(() => { });
    };

    const handleMoveClick = (index) => {
        const fenIdx = index + 1;
        const newIndex = fenIdx >= fenHistory.length - 1 ? null : fenIdx;
        if (newIndex === viewIndex) return;

        const dest = newIndex ?? fenHistory.length - 1;
        if (dest > 0 && fenHistory[dest - 1] && fenHistory[dest]) {
            const game = new Chess(fenHistory[dest - 1]);
            const sound = getBotMoveSound(game, fenHistory[dest]);
            soundsRef.current[sound].currentTime = 0;
            soundsRef.current[sound].play().catch(() => { });
        }

        setViewIndex(newIndex);
    };

    const handleNav = useCallback((dir) => {
        const latest = fenHistory.length - 1;
        const cur = viewIndex ?? latest;
        let newIndex;

        if (dir === "prev") {
            if (cur === 0) return;
            newIndex = cur - 1;
        } else if (dir === "next") {
            if (viewIndex === null) return;
            newIndex = cur + 1 >= latest ? null : cur + 1;
        } else {
            return;
        }

        const dest = newIndex ?? latest;
        if (dest > 0 && fenHistory[dest - 1] && fenHistory[dest]) {
            const game = new Chess(fenHistory[dest - 1]);
            const sound = getBotMoveSound(game, fenHistory[dest]);
            soundsRef.current[sound].currentTime = 0;
            soundsRef.current[sound].play().catch(() => { });
        }

        setViewIndex(newIndex);
    }, [fenHistory, viewIndex]);

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === "ArrowLeft") handleNav("prev");
            else if (e.key === "ArrowRight") handleNav("next");
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [handleNav]);

    const displayFen = viewIndex !== null ? fenHistory[viewIndex] : fen;
    const atStart = (viewIndex ?? fenHistory.length - 1) === 0;
    const atEnd = viewIndex === null;
    const activeMoveIndex = (viewIndex ?? fenHistory.length - 1) - 1;

    const overlayGradient =
        gameResult === "win"
            ? "radial-gradient(ellipse at center, rgba(50,200,80,0) 30%, rgba(50,200,80,0.28) 100%)"
            : gameResult === "lose"
                ? "radial-gradient(ellipse at center, rgba(220,50,50,0) 30%, rgba(220,50,50,0.28) 100%)"
                : null;

    return (
        <div style={styles.page}>
            <div style={{
                position: "fixed",
                inset: 0,
                background: overlayGradient ?? "transparent",
                pointerEvents: "none",
                zIndex: 1,
                opacity: phase === "over" && overlayGradient ? 1 : 0,
                transition: "opacity 0.8s ease",
            }} />
            {showSettings && (
                <SettingsModal
                    onClose={() => setShowSettings(false)}
                    onResetStats={handleResetStats}
                    onResetModel={handleResetModel}
                    onImportGames={handleImportGames}
                />
            )}
            {phase === "setup" && (
                <div style={styles.setup}>
                    <h1 style={styles.title}>Mirror AI Chess Bot</h1>
                    <p style={styles.subtitle}>Pick your color to start a game.</p>
                    <div style={styles.colorButtons}>
                        <button className="btn" style={styles.btn} onClick={() => startGame("white")}>
                            Play as White
                        </button>
                        <button className="btn" style={styles.btn} onClick={() => startGame("black")}>
                            Play as Black
                        </button>
                    </div>
                </div>
            )}

            {phase !== "setup" && (
                <>
                    <h1 style={styles.title}>Mirror AI Chess Bot</h1>
                    <div style={styles.game}>
                        <div style={styles.boardColumn}>
                            <Board
                                fen={displayFen}
                                userColor={userColor}
                                onMove={handleMove}
                                disabled={phase === "over" || viewIndex !== null}
                                onIllegalMove={() => {
                                    const snd = soundsRef.current.illegal;
                                    snd.currentTime = 0;
                                    snd.play().catch(() => { });
                                }}
                            />
                            <Record wins={record.wins} losses={record.losses} draws={record.draws} />
                        </div>
                        <div style={styles.sidebar}>
                            <Status text={status} />
                            <MoveLog moves={moveLog} activeMoveIndex={activeMoveIndex} onMoveClick={handleMoveClick} />
                            <GameControls
                                phase={phase}
                                onSettings={handleSettings}
                                onQuit={handleQuit}
                                canAbort={canAbort}
                                onPlayAgain={handlePlayAgain}
                                onNav={handleNav}
                                atStart={atStart}
                                atEnd={atEnd}
                            />
                        </div>
                    </div>
                </>
            )}

            <div style={styles.watermark}>Made by Dylan Nguyen :)</div>
        </div>
    );
}

const styles = {
    page: {
        height: "100vh",
        background: "linear-gradient(160deg, #000000 0%, #1c1c1c 45%, #0a0a0a 100%)",
        color: "#b0b8c8",
        fontFamily: "'Rajdhani', sans-serif",
        padding: "12px 12px 4px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
    },
    title: {
        margin: "0 0 6px",
        fontSize: 30,
        letterSpacing: 4,
        color: "#8eafd4",
        fontWeight: 600,
        textAlign: "center",
    },
    subtitle: {
        margin: "0 0 20px",
        color: "#606878",
        fontSize: 15,
        textAlign: "center",
    },
    setup: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        flex: 1,
        justifyContent: "center",
    },
    colorButtons: {
        display: "flex",
        gap: 12,
    },
    btn: {
        padding: "10px 22px",
        background: "transparent",
        color: "#8eafd4",
        border: "1px solid #8eafd4",
        borderRadius: 4,
        cursor: "pointer",
        fontFamily: "'Rajdhani', sans-serif",
        fontWeight: 600,
        fontSize: 15,
        letterSpacing: 1,
    },
    game: {
        display: "flex",
        gap: 28,
        alignItems: "stretch",
        marginTop: 12,
        flexWrap: "wrap",
        justifyContent: "center",
    },
    boardColumn: {
        display: "flex",
        flexDirection: "column",
    },
    sidebar: {
        display: "flex",
        flexDirection: "column",
        width: 280,
        minWidth: 220,
    },
    watermark: {
        marginTop: "auto",
        paddingTop: 6,
        fontSize: 12,
        color: "#2e3440",
        letterSpacing: 1,
        fontFamily: "'Rajdhani', sans-serif",
    },
};

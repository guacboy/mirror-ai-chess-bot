import { useState, useRef, useCallback, useEffect } from "react";
import { Chess } from "chess.js";
import Board from "./components/Board";
import GameControls from "./components/GameControls";
import MoveLog from "./components/MoveLog";
import Record from "./components/Record";
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

// TODO(feat): settings functionality (ability to reset model, import games)
// TODO(feat): stockfish auto-adjusts its rating based on user's skill level
// TODO(feat): resign/abort functionality
// TODO(feat): have the "play again" button start a new game as the opposite color rather than go back to the main menu
// TODO(feat): sound effects for when the king is in check, when a piece can't be moved because the king is in check, and checkmate sound
// TODO(bug): fix move list from expanding downwards, only make the window scrollable if the list gets too large

// Identifies the sound to play for a bot move by matching legal moves against the resulting FEN.
function getBotMoveSound(game, newFen) {
    const newBoard = newFen.split(" ")[0];
    for (const m of game.moves({ verbose: true })) {
        const tmp = new Chess(game.fen());
        tmp.move(m);
        if (tmp.fen().split(" ")[0] === newBoard) {
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

    const wsRef = useRef(null);
    const soundsRef = useRef({
        move: new Audio("/sounds/move.mp3"),
        capture: new Audio("/sounds/capture.mp3"),
        castle: new Audio("/sounds/castle.mp3"),
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
                soundsRef.current[sound].currentTime = 0;
                soundsRef.current[sound].play().catch(() => { });
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

        const sound = match.flags.includes("k") || match.flags.includes("q")
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

    // Resets everything back to the color-picker screen.
    const handlePlayAgain = () => {
        wsRef.current?.close();
        setPhase("setup");
        setFen("start");
        setMoveLog([]);
        setStatus("");
        setFenHistory([]);
        setViewIndex(null);
        setGameResult(null);
        gameRef.current = new Chess();
    };

    const handleSettings = () => {};
    const canAbort = fenHistory.length - 1 < 3;
    const handleQuit = () => wsRef.current?.send(JSON.stringify({ type: canAbort ? "abort" : "resign" }));

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
                            />
                            <Record wins={record.wins} losses={record.losses} draws={record.draws} />
                        </div>
                        <div style={styles.sidebar}>
                            <Status text={status} />
                            <MoveLog moves={moveLog} style={{ flex: 1, minHeight: 0 }} activeMoveIndex={activeMoveIndex} onMoveClick={handleMoveClick} />
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

import { useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";

// Board renders the interactive chess board.
// Args:
//   fen      : current board position as a FEN string, kept in sync with the server
//   userColor: "white" or "black", determines which side faces the player
//   onMove   : called with (sourceSquare, targetSquare) when a piece is dropped;
//              should return true to confirm the move or false to snap the piece back
//   disabled : when true (game over), drops are ignored so pieces can't be moved
export default function Board({ fen, userColor, onMove, disabled, onIllegalMove }) {
    // Flips the board so the player's pieces are always at the bottom.
    const orientation = userColor === "white" ? "white" : "black";

    const [selectedSquare, setSelectedSquare] = useState(null);
    const [checkFlash, setCheckFlash] = useState(null); // { square, nonce }

    // Deselect whenever the position changes (after any move, or while navigating history).
    useEffect(() => {
        setSelectedSquare(null);
    }, [fen]);

    const game = useMemo(() => {
        try {
            return new Chess(fen);
        } catch {
            return new Chess();
        }
    }, [fen]);

    const legalTargets = useMemo(() => {
        if (!selectedSquare) return [];
        return game.moves({ square: selectedSquare, verbose: true }).map((m) => m.to);
    }, [game, selectedSquare]);

    // Briefly flashes the king's square red and plays the illegal sound when a move is rejected while in check.
    const flashCheck = () => {
        if (!game.inCheck()) return;
        onIllegalMove?.();
        const [kingSquare] = game.findPiece({ type: "k", color: game.turn() });
        if (!kingSquare) return;
        setCheckFlash((prev) => ({
            square: kingSquare,
            nonce: (prev?.nonce ?? 0) + 1,
        }));
    };

    // Returning false snaps the piece back to where it was dragged from.
    const handleDrop = ({ sourceSquare, targetSquare }) => {
        if (disabled) return false;
        const success = onMove(sourceSquare, targetSquare);
        if (success) setSelectedSquare(null);
        else flashCheck();
        return success;
    };

    // Shows legal-move dots while a piece is being dragged.
    const handlePieceDrag = ({ piece, square }) => {
        if (disabled || !square) return;
        if (piece.pieceType[0] === orientation[0]) {
            setSelectedSquare(square);
        }
    };

    // Supports click-to-move: select a piece to see its legal targets, then click one to move.
    const handleSquareClick = ({ square, piece }) => {
        if (disabled) return;

        if (selectedSquare && legalTargets.includes(square)) {
            const success = onMove(selectedSquare, square);
            if (success) setSelectedSquare(null);
            else flashCheck();
            return;
        }

        if (piece && piece.pieceType[0] === orientation[0]) {
            setSelectedSquare(square === selectedSquare ? null : square);
        } else {
            setSelectedSquare(null);
        }
    };

    const squareStyles = useMemo(() => {
        const styles = {};

        if (selectedSquare) {
            styles[selectedSquare] = { backgroundColor: "rgba(142,175,212,0.35)" };
        }

        for (const target of legalTargets) {
            const occupied = !!game.get(target);
            styles[target] = {
                ...styles[target],
                backgroundImage: occupied
                    ? "radial-gradient(circle, transparent 56%, rgba(20,20,20,0.35) 58%, rgba(20,20,20,0.35) 72%, transparent 74%)"
                    : "radial-gradient(circle, rgba(20,20,20,0.35) 17%, transparent 19%)",
                backgroundPosition: "center",
                backgroundRepeat: "no-repeat",
            };
        }

        if (checkFlash) {
            styles[checkFlash.square] = {
                ...styles[checkFlash.square],
                animation: `check-flash-${checkFlash.nonce % 2 === 0 ? "a" : "b"} 0.6s ease-out`,
            };
        }

        return styles;
    }, [selectedSquare, legalTargets, game, checkFlash]);

    return (
        // Controls the board's pixel size.
        <div style={{ width: 480, flexShrink: 0 }}>
            {}
            <Chessboard
                options={{
                    position: fen,
                    onPieceDrop: handleDrop,
                    onPieceDrag: handlePieceDrag,
                    onSquareClick: handleSquareClick,
                    boardOrientation: orientation,
                    darkSquareStyle: { backgroundColor: "#4a7c59" },
                    lightSquareStyle: { backgroundColor: "#f0d9b5" },
                    squareStyles,
                }}
            />
        </div>
    );
}

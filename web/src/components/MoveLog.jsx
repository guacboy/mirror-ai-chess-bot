import { useEffect, useRef } from "react";

export default function MoveLog({ moves, activeMoveIndex, onMoveClick }) {
    const activeRef = useRef(null);

    useEffect(() => {
        activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, [activeMoveIndex, moves.length]);

    return (
        <div style={styles.container}>
            <div style={styles.header}>Move Log</div>
            <div style={styles.list}>
                {moves.length === 0 && (
                    <div style={styles.empty}>No moves yet.</div>
                )}
                {moves.map((m, i) => (
                    <div
                        key={i}
                        ref={i === activeMoveIndex ? activeRef : null}
                        className="move-entry"
                        style={{
                            ...styles.entry,
                            color: m.by === "bot" ? "#c9a84c" : "#eee",
                            ...(i === activeMoveIndex ? styles.activeEntry : {}),
                        }}
                        onClick={() => onMoveClick?.(i)}
                    >
                        {m.text}
                    </div>
                ))}
            </div>
        </div>
    );
}

const styles = {
    container: {
        marginTop: 16,
        border: "1px solid rgba(142,175,212,0.15)",
        borderRadius: 6,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
    },
    header: {
        padding: "6px 10px",
        background: "rgba(255,255,255,0.03)",
        fontSize: 11,
        letterSpacing: 2,
        textTransform: "uppercase",
        color: "#4a5a6a",
        fontFamily: "'Rajdhani', sans-serif",
    },
    list: {
        height: 300,
        overflowY: "auto",
        padding: "6px 10px",
        background: "rgba(0,0,0,0.4)",
    },
    entry: {
        fontSize: 13,
        lineHeight: "1.8",
        fontFamily: "'Share Tech Mono', monospace",
        borderRadius: 3,
        padding: "0 4px",
        margin: "0 -4px",
    },
    activeEntry: {
        background: "rgba(142,175,212,0.14)",
    },
    empty: {
        fontSize: 13,
        color: "#333a44",
        fontFamily: "'Share Tech Mono', monospace",
    },
};

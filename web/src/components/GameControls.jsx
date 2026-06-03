export default function GameControls({ phase, onSettings, onQuit, canAbort, onPlayAgain, onNav, atStart, atEnd }) {
    const navBtn = (disabled) => ({
        ...styles.navBtn,
        opacity: disabled ? 0.25 : 1,
        cursor: disabled ? "default" : "pointer",
    });

    return (
        <div style={styles.container}>
            {phase === "playing" && (
                <div style={styles.actions}>
                    <button className="btn" style={styles.actionBtn} onClick={onSettings}>Settings</button>
                    <button className="btn btn-quit" style={{ ...styles.actionBtn, ...styles.quitBtn }} onClick={onQuit}>
                        {canAbort ? "Abort" : "Resign"}
                    </button>
                </div>
            )}
            {phase === "over" && (
                <div style={styles.actions}>
                    <button className="btn" style={styles.actionBtn} onClick={onPlayAgain}>Play Again</button>
                </div>
            )}
            <div style={styles.nav}>
                <button className={atStart ? "" : "btn"} style={navBtn(atStart)} onClick={() => onNav("prev")} disabled={atStart}>‹</button>
                <button className={atEnd ? "" : "btn"} style={navBtn(atEnd)} onClick={() => onNav("next")} disabled={atEnd}>›</button>
            </div>
        </div>
    );
}

const styles = {
    container: {
        marginTop: "auto",
        paddingTop: 12,
        borderTop: "1px solid rgba(142,175,212,0.1)",
    },
    actions: {
        display: "flex",
        gap: 8,
        marginBottom: 8,
    },
    actionBtn: {
        flex: 1,
        padding: "7px 0",
        background: "transparent",
        color: "#8eafd4",
        border: "1px solid rgba(142,175,212,0.3)",
        borderRadius: 4,
        cursor: "pointer",
        fontFamily: "'Rajdhani', sans-serif",
        fontWeight: 600,
        fontSize: 13,
        letterSpacing: 1,
    },
    quitBtn: {
        color: "#c47a7a",
        borderColor: "rgba(196,122,122,0.3)",
    },
    nav: {
        display: "flex",
        gap: 6,
    },
    navBtn: {
        flex: 1,
        padding: "8px 0",
        background: "rgba(255,255,255,0.03)",
        color: "#8eafd4",
        border: "1px solid rgba(142,175,212,0.15)",
        borderRadius: 4,
        fontFamily: "'Rajdhani', sans-serif",
        fontSize: 18,
        fontWeight: 700,
    },
};

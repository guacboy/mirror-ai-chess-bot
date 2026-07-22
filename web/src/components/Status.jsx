import { useState } from "react";

function StatRow({ label, value }) {
    return (
        <div style={styles.statRow}>
            <span style={styles.statLabel}>{label}</span>
            <span style={styles.statValue}>{value}</span>
        </div>
    );
}

export default function Status({ text, detail }) {
    const [open, setOpen] = useState(false);

    if (!text) return null;

    return (
        <div style={styles.box}>
            <div>{text}</div>
            {detail && (
                <>
                    <button style={styles.toggle} onClick={() => setOpen((v) => !v)}>
                        {open ? "less detail ▴" : "more detail ▾"}
                    </button>
                    {open && (
                        <div style={styles.panel}>
                            <StatRow
                                label="Games learned from"
                                value={detail.gamesPlayed}
                            />
                            <StatRow
                                label="Stockfish level"
                                value={`${detail.sfSkill ?? 10} / 20${detail.sfAuto ? "  ·  auto" : ""}`}
                            />
                            <div style={styles.divider} />
                            <StatRow
                                label={detail.isActual ? "This game — Model" : "Expected — Model"}
                                value={`${detail.modelPct}%`}
                            />
                            <StatRow label="Stockfish" value={`${detail.sfPct}%`} />
                            {detail.rPct > 0 && (
                                <StatRow label="Random" value={`${detail.rPct}%`} />
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

const styles = {
    box: {
        padding: "10px 12px",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(142,175,212,0.2)",
        borderRadius: 6,
        fontSize: 14,
        lineHeight: "1.6",
        color: "#8eafd4",
        fontFamily: "'Rajdhani', sans-serif",
        letterSpacing: 0.5,
    },
    toggle: {
        display: "block",
        marginTop: 4,
        background: "none",
        border: "none",
        padding: 0,
        color: "#4a5a6a",
        fontSize: 11,
        fontFamily: "'Rajdhani', sans-serif",
        letterSpacing: 0.5,
        cursor: "pointer",
    },
    panel: {
        marginTop: 8,
        borderTop: "1px solid rgba(142,175,212,0.1)",
        paddingTop: 8,
        display: "flex",
        flexDirection: "column",
        gap: 3,
    },
    statRow: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        fontSize: 12,
    },
    statLabel: {
        color: "#4a5a6a",
        letterSpacing: 0.3,
    },
    statValue: {
        color: "#8eafd4",
        fontWeight: 600,
        letterSpacing: 0.5,
    },
    divider: {
        height: 1,
        background: "rgba(142,175,212,0.08)",
        margin: "3px 0",
    },
};

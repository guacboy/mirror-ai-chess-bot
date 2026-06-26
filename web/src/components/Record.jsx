export default function Record({ wins, losses, draws }) {
    return (
        <div style={styles.bar}>
            <span style={styles.stat}><span style={styles.win}>{wins}</span> W</span>
            <span style={styles.divider}>·</span>
            <span style={styles.stat}><span style={styles.loss}>{losses}</span> L</span>
            <span style={styles.divider}>·</span>
            <span style={styles.stat}><span style={styles.draw}>{draws}</span> D</span>
        </div>
    );
}

const styles = {
    bar: {
        display: "flex",
        justifyContent: "center",
        gap: 10,
        marginTop: 10,
        padding: "8px 0",
        fontFamily: "'Rajdhani', sans-serif",
        fontSize: 14,
        letterSpacing: 1,
        color: "#606878",
    },
    stat: {
        fontWeight: 600,
    },
    win: { color: "#7fae6a" },
    loss: { color: "#c47a7a" },
    draw: { color: "#8eafd4" },
    divider: {
        color: "#2e3440",
    },
};

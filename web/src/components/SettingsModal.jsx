import { useRef, useState } from "react";

function SettingRow({ label, desc, action, danger, onClick }) {
    return (
        <div style={styles.row}>
            <div style={styles.rowText}>
                <div style={styles.rowLabel}>{label}</div>
                <div style={styles.rowDesc}>{desc}</div>
            </div>
            <button
                className={danger ? "btn btn-quit" : "btn"}
                style={{ ...styles.rowBtn, ...(danger ? styles.rowBtnDanger : {}) }}
                onClick={onClick}
            >
                {action}
            </button>
        </div>
    );
}

export default function SettingsModal({ onClose, onResetStats, onResetModel, onImportGames }) {
    const fileRef = useRef(null);
    const [closeHover, setCloseHover] = useState(false);

    const handleFileChange = (e) => {
        const file = e.target.files?.[0];
        if (file) onImportGames(file);
        e.target.value = "";
    };

    return (
        <div style={styles.backdrop} onClick={onClose}>
            <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
                <div style={styles.header}>
                    <span style={styles.title}>Settings</span>
                    <button
                        style={{ ...styles.closeBtn, color: closeHover ? "#b0b8c8" : "#4a5a6a" }}
                        onClick={onClose}
                        onMouseEnter={() => setCloseHover(true)}
                        onMouseLeave={() => setCloseHover(false)}
                    >✕</button>
                </div>
                <div style={styles.body}>
                    <SettingRow
                        label="Import Games"
                        desc="Load a PGN file to train the bot on your playstyle"
                        action="Import"
                        onClick={() => fileRef.current?.click()}
                    />
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".pgn"
                        style={{ display: "none" }}
                        onChange={handleFileChange}
                    />
                    <SettingRow
                        label="Reset Model"
                        desc="Clear the bot's learned playstyle and start fresh"
                        action="Reset"
                        danger
                        onClick={onResetModel}
                    />
                    <SettingRow
                        label="Reset W/L Stats"
                        desc="Clear your win/loss/draw record"
                        action="Reset"
                        danger
                        onClick={onResetStats}
                    />
                </div>
            </div>
        </div>
    );
}

const styles = {
    backdrop: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    modal: {
        background: "#0e1117",
        border: "1px solid rgba(142,175,212,0.18)",
        borderRadius: 8,
        width: 380,
        fontFamily: "'Rajdhani', sans-serif",
        boxShadow: "0 8px 40px rgba(0,0,0,0.7)",
    },
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 16px 12px",
        borderBottom: "1px solid rgba(142,175,212,0.1)",
    },
    title: {
        fontSize: 15,
        fontWeight: 700,
        letterSpacing: 2,
        textTransform: "uppercase",
        color: "#8eafd4",
    },
    closeBtn: {
        background: "none",
        border: "none",
        color: "#4a5a6a",
        fontSize: 16,
        cursor: "pointer",
        padding: "0 2px",
        lineHeight: 1,
    },
    body: {
        padding: "8px 0 4px",
    },
    row: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 16px",
        gap: 12,
    },
    rowText: {
        flex: 1,
        minWidth: 0,
    },
    rowLabel: {
        fontSize: 14,
        fontWeight: 600,
        color: "#b0b8c8",
        letterSpacing: 0.5,
    },
    rowDesc: {
        fontSize: 11,
        color: "#4a5a6a",
        marginTop: 2,
        letterSpacing: 0.3,
    },
    rowBtn: {
        flexShrink: 0,
        padding: "5px 14px",
        background: "transparent",
        color: "#8eafd4",
        border: "1px solid rgba(142,175,212,0.3)",
        borderRadius: 4,
        cursor: "pointer",
        fontFamily: "'Rajdhani', sans-serif",
        fontWeight: 600,
        fontSize: 12,
        letterSpacing: 1,
    },
    rowBtnDanger: {
        color: "#c47a7a",
        borderColor: "rgba(196,122,122,0.3)",
    },
};

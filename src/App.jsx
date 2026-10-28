// src/App.jsx
import { useEffect, useReducer, useRef, useState } from "react";
import {
  createMatch,
  reducer,
  isValidMatch,
  isDecidingSet,
  isSetFresh,
  pointsToWin,
  setsToWin,
  parseRoster,
  setupProblems,
  canLiberoEnter,
  LIMITS,
  MAX_LABEL,
  MAX_ROSTER,
} from "./matchEngine.js";

const STORAGE_KEY = "love-at-first-spike-match-v4";
const COLORS = ["#f97316", "#38bdf8"]; // team accent colors
const CARD_BG = "#1e293b";

// Cutout images for the setup page slideshow (files live in the project's public folder).
const BASE = import.meta.env.BASE_URL;
const SLIDES = [`${BASE}kageyama.png`, `${BASE}kag2.png`];

// Court geometry. Lineup index k is court position k + 1.
// position -> [column, row]. Row 0 is the front row (next to the net).
const TILE = 64;
const GAP = 8;
const SLOT_POS = {
  4: [0, 0],
  3: [1, 0],
  2: [2, 0],
  5: [0, 1],
  6: [1, 1],
  1: [2, 1],
};
const COURT_ROWS = [
  [4, 3, 2],
  [5, 6, 1],
];

const CSS = `
/* Players slide around the court when a team rotates */
.tile {
  position: absolute;
  will-change: left, top;
  transition: left 650ms cubic-bezier(.45,.05,.25,1), top 650ms cubic-bezier(.45,.05,.25,1);
  animation: pop 350ms ease-out;
}
.pop { animation: pop 350ms ease-out; }
@keyframes pop {
  from { transform: scale(.55); opacity: 0; }
  to { transform: none; opacity: 1; }
}

/* Highlight on tiles that can be tapped to complete a swap */
.target { animation: targetPulse 1s ease-in-out infinite; }
@keyframes targetPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(250,204,21,0); }
  50% { box-shadow: 0 0 0 4px rgba(250,204,21,.45); }
}

/* Serving ball: drops in on the serving team, then bounces and spins */
.ballIn {
  position: relative;
  width: 44px;
  height: 56px;
  animation: ballDrop 600ms cubic-bezier(.3,1.4,.5,1) both;
}
.ballBounce {
  font-size: 32px;
  line-height: 1;
  text-align: center;
  animation: ballBounce 900ms cubic-bezier(.3,0,.6,1) infinite;
}
.ballSpin { display: inline-block; animation: ballSpin 2.4s linear infinite; }
.ballShadow {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 26px;
  height: 6px;
  margin-left: -13px;
  border-radius: 50%;
  background: rgba(0,0,0,.45);
  animation: ballShadow 900ms cubic-bezier(.3,0,.6,1) infinite;
}
@keyframes ballDrop {
  from { transform: translateY(-50px) scale(.5); opacity: 0; }
  to { transform: none; opacity: 1; }
}
@keyframes ballBounce {
  0%, 100% { transform: translateY(16px); }
  50% { transform: translateY(-4px); }
}
@keyframes ballSpin { to { transform: rotate(360deg); } }
@keyframes ballShadow {
  0%, 100% { transform: scaleX(1); opacity: .5; }
  50% { transform: scaleX(.55); opacity: .25; }
}

/* + Point button: a bright swoosh sweeps across it on every click */
.pointBtn { position: relative; overflow: hidden; transition: transform 120ms, filter 120ms; }
.pointBtn:not(:disabled):hover { filter: brightness(1.1); }
.pointBtn:not(:disabled):active { transform: scale(.94); }
.swoosh {
  position: absolute;
  top: -20%;
  bottom: -20%;
  left: -60%;
  width: 45%;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,.95), transparent);
  transform: skewX(-20deg);
  pointer-events: none;
  animation: swoosh 520ms ease-out forwards;
}
@keyframes swoosh { from { left: -60%; } to { left: 130%; } }

/* The score pops whenever it changes */
.scorePop { animation: scorePop 350ms ease-out; }
@keyframes scorePop {
  from { transform: scale(1.35); filter: brightness(1.6); }
  to { transform: none; filter: none; }
}

/* Setup page: character cutouts cross-fade inside their panel */
.cutout {
  position: absolute;
  left: 50%;
  bottom: 0;
  height: 94%;
  width: auto;
  max-width: 96%;
  object-fit: contain;
  opacity: 0;
  transform: translateX(-50%) translateY(14px) scale(.98);
  transition: opacity 900ms ease, transform 900ms ease;
  filter: drop-shadow(0 8px 16px rgba(0,0,0,.35));
  pointer-events: none;
}
.cutout.active { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }

@media (prefers-reduced-motion: reduce) {
  .tile, .pop, .target, .ballIn, .ballBounce, .ballSpin, .ballShadow,
  .swoosh, .scorePop, .cutout, .pointBtn {
    animation: none !important;
    transition: none !important;
  }
}
`;

// Load a saved match so an accidental refresh does not lose anything.
function loadMatch() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createMatch();
    const m = JSON.parse(raw);
    return isValidMatch(m) ? m : createMatch();
  } catch {
    return createMatch();
  }
}

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.2;
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
    setTimeout(() => ctx.close(), 800);
  } catch {
    /* sound is optional */
  }
}

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Long names get a smaller font so they still fit in a tile.
function labelFontSize(label) {
  const n = label.trim().length;
  if (n <= 2) return 24;
  if (n <= 4) return 18;
  if (n <= 7) return 14;
  return 12;
}

// =====================================================================
// SETUP PAGE
// =====================================================================

// Slideshow of the character cutouts (only shown before the match starts).
function CutoutSlideshow() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIndex((n) => (n + 1) % SLIDES.length), 4500);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          position: "relative",
          width: 260,
          height: 360,
          borderRadius: 24,
          overflow: "hidden",
          background: "linear-gradient(160deg, #fed7aa 0%, #fdba74 55%, #fb923c 100%)",
          boxShadow: "0 12px 40px rgba(0,0,0,.45)",
        }}
      >
        {SLIDES.map((src, i) => (
          <img key={src} src={src} alt="" className={i === index ? "cutout active" : "cutout"} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 10 }}>
        {SLIDES.map((src, i) => (
          <span
            key={src}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: i === index ? "#fb923c" : "#475569",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function NumberField({ label, hint, value, limits, disabled, onCommit }) {
  const [min, max] = limits;
  const [text, setText] = useState(String(value));

  useEffect(() => setText(String(value)), [value]);

  const commit = () => {
    const n = parseInt(text, 10);
    if (Number.isNaN(n)) {
      setText(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, n));
    setText(String(clamped));
    onCommit(clamped);
  };

  return (
    <label style={{ display: "block", textAlign: "left" }}>
      <div style={{ fontSize: 13, color: "#cbd5e1", marginBottom: 4 }}>{label}</div>
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        style={{
          width: "100%",
          padding: 8,
          fontSize: 16,
          borderRadius: 8,
          border: "none",
          background: disabled ? "#2b3a4f" : "#334155",
          color: "white",
          opacity: disabled ? 0.6 : 1,
        }}
      />
      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
        {hint || `${min} to ${max}`}
      </div>
    </label>
  );
}

function RulesCard({ match, dispatch }) {
  const r = match.rules;
  const update = (patch) => dispatch({ type: "SET_RULES", rules: patch });

  const stepButton = (label, delta) => {
    const next = r.bestOf + delta;
    const off = next < LIMITS.bestOf[0] || next > LIMITS.bestOf[1];
    return (
      <button
        onClick={() => update({ bestOf: next })}
        disabled={off}
        style={{
          width: 40,
          height: 40,
          fontSize: 20,
          borderRadius: 8,
          border: "1px solid #64748b",
          background: "transparent",
          color: "white",
          cursor: off ? "not-allowed" : "pointer",
          opacity: off ? 0.4 : 1,
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div style={{ background: CARD_BG, borderRadius: 16, padding: 20, maxWidth: 560, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: "#cbd5e1", marginBottom: 6 }}>Number of sets</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16 }}>
          {stepButton("−", -2)}
          <div style={{ fontSize: 20, fontWeight: "bold", minWidth: 150 }}>
            Best of {r.bestOf}
            <div style={{ fontSize: 12, fontWeight: "normal", color: "#94a3b8" }}>
              first to {setsToWin(r)} {setsToWin(r) === 1 ? "set" : "sets"}
            </div>
          </div>
          {stepButton("+", 2)}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <NumberField
          label="Points per set"
          value={r.setPoints}
          limits={LIMITS.setPoints}
          onCommit={(v) => update({ setPoints: v })}
        />
        <NumberField
          label="Points in deciding set"
          value={r.decidingPoints}
          limits={LIMITS.decidingPoints}
          disabled={r.bestOf === 1}
          hint={r.bestOf === 1 ? "Not used in best of 1" : undefined}
          onCommit={(v) => update({ decidingPoints: v })}
        />
        <NumberField
          label="Timeouts per team, per set"
          value={r.timeoutsPerSet}
          limits={LIMITS.timeoutsPerSet}
          onCommit={(v) => update({ timeoutsPerSet: v })}
        />
        <NumberField
          label="Timeout length (seconds)"
          value={r.timeoutSeconds}
          limits={LIMITS.timeoutSeconds}
          hint="120 = 2 minutes"
          onCommit={(v) => update({ timeoutSeconds: v })}
        />
      </div>
    </div>
  );
}

const smallButton = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid #64748b",
  background: "transparent",
  color: "white",
  cursor: "pointer",
  fontSize: 13,
};

function TeamSetup({ team, match, dispatch }) {
  const color = COLORS[team];
  const rosterText = match.setup.rosterText[team];
  const court = match.setup.court[team];
  const libero = match.setup.libero[team];
  const labels = parseRoster(rosterText);
  const problems = setupProblems(match)[team];

  // Players that can still be chosen for a court position (not used elsewhere, not the libero).
  const optionsFor = (slot) => {
    const taken = new Set(court.filter((c, i) => i !== slot && c));
    if (libero) taken.add(libero);
    return labels.filter((l) => !taken.has(l));
  };
  const liberoOptions = labels.filter((l) => !court.includes(l));

  const selectBase = {
    background: "#334155",
    color: "white",
    borderRadius: 8,
    colorScheme: "dark",
    fontSize: 16,
  };

  return (
    <div
      style={{
        background: CARD_BG,
        borderRadius: 16,
        padding: 20,
        width: 420,
        maxWidth: "100%",
        borderTop: `4px solid ${color}`,
        textAlign: "left",
      }}
    >
      <input
        value={match.names[team]}
        onChange={(e) => dispatch({ type: "SET_NAME", team, name: e.target.value })}
        placeholder={`Team ${team === 0 ? "A" : "B"} name`}
        style={{
          width: "100%",
          fontSize: 20,
          textAlign: "center",
          padding: 8,
          borderRadius: 8,
          border: "none",
          background: "#334155",
          color: "white",
          marginBottom: 14,
        }}
      />

      {/* Who serves first */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <button
          onClick={() => dispatch({ type: "SET_FIRST_SERVER", team })}
          style={{
            ...smallButton,
            borderColor: match.serving === team ? color : "#64748b",
            background: match.serving === team ? color : "transparent",
            color: match.serving === team ? "#0f172a" : "white",
            fontWeight: match.serving === team ? "bold" : "normal",
          }}
        >
          {match.serving === team ? "🏐 Serves first" : "Serve first"}
        </button>
      </div>

      {/* Players list */}
      <div style={{ fontSize: 13, color: "#cbd5e1", marginBottom: 4 }}>
        Players (jersey numbers or names, separated by commas)
      </div>
      <textarea
        value={rosterText}
        onChange={(e) => dispatch({ type: "SET_ROSTER", team, text: e.target.value })}
        rows={3}
        placeholder="e.g. 4, 5, 77, 11, 23, 8, 9"
        style={{
          width: "100%",
          padding: 8,
          fontSize: 16,
          borderRadius: 8,
          border: "none",
          background: "#334155",
          color: "white",
          resize: "vertical",
          fontFamily: "inherit",
        }}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "6px 0 16px", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>
          {labels.length} player{labels.length === 1 ? "" : "s"} · max {MAX_ROSTER}, {MAX_LABEL} characters each
        </span>
        <button onClick={() => dispatch({ type: "FILL_EXAMPLE", team })} style={smallButton}>
          Example
        </button>
      </div>

      {/* Libero */}
      <div style={{ fontSize: 13, color: "#67e8f9", marginBottom: 4 }}>Libero</div>
      <select
        value={libero}
        onChange={(e) => dispatch({ type: "SET_LIBERO", team, value: e.target.value })}
        style={{ ...selectBase, width: "100%", padding: 8, border: "1px solid #0e7490", marginBottom: 16 }}
      >
        <option value="">No libero</option>
        {liberoOptions.map((l, i) => (
          <option key={`${l}-${i}`} value={l}>
            {l}
          </option>
        ))}
      </select>

      {/* Starting six */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, color: "#cbd5e1" }}>Starting six</div>
        <button onClick={() => dispatch({ type: "AUTO_FILL", team })} style={smallButton}>
          Auto-fill
        </button>
      </div>

      <div
        style={{
          borderTop: "3px solid #94a3b8",
          width: 3 * TILE + 2 * GAP,
          margin: "0 auto 10px",
          fontSize: 11,
          color: "#94a3b8",
          paddingTop: 4,
          letterSpacing: 2,
        }}
      >
        NET
      </div>
      {COURT_ROWS.map((row, r) => (
        <div key={r} style={{ display: "flex", gap: GAP, justifyContent: "center", marginBottom: GAP }}>
          {row.map((pos) => (
            <div key={pos} style={{ position: "relative", width: TILE, height: TILE }}>
              <span
                style={{
                  position: "absolute",
                  top: 3,
                  left: 7,
                  fontSize: 10,
                  color: "#94a3b8",
                  pointerEvents: "none",
                  zIndex: 1,
                }}
              >
                {pos}
              </span>
              <select
                value={court[pos - 1]}
                onChange={(e) =>
                  dispatch({ type: "SET_COURT", team, index: pos - 1, value: e.target.value })
                }
                style={{
                  ...selectBase,
                  width: "100%",
                  height: "100%",
                  textAlign: "center",
                  textAlignLast: "center",
                  paddingTop: 12,
                  border: pos === 1 ? `2px solid ${color}` : "2px solid transparent",
                }}
              >
                <option value="">–</option>
                {optionsFor(pos - 1).map((l, i) => (
                  <option key={`${l}-${i}`} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      ))}
      <div style={{ fontSize: 12, color: "#94a3b8", textAlign: "center" }}>
        Position 1 (outlined) is the server. Everyone not chosen becomes a reserve.
      </div>

      {/* Problems or ready */}
      <div style={{ marginTop: 14, fontSize: 13 }}>
        {problems.length === 0 ? (
          <div style={{ color: "#4ade80" }}>✓ Ready</div>
        ) : (
          problems.map((p) => (
            <div key={p} style={{ color: "#fca5a5", marginBottom: 4 }}>
              • {p}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SetupPage({ match, dispatch }) {
  const ready = setupProblems(match).every((list) => list.length === 0);

  const sectionTitle = (text) => (
    <h2 style={{ fontSize: 20, margin: "32px 0 14px" }}>{text}</h2>
  );

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      {/* Hero with the character slideshow */}
      <div
        style={{
          display: "flex",
          gap: 32,
          alignItems: "center",
          justifyContent: "center",
          flexWrap: "wrap",
          marginBottom: 8,
        }}
      >
        <div style={{ maxWidth: 440, textAlign: "left" }}>
          <h1 style={{ fontSize: 44, lineHeight: 1.05, marginBottom: 12 }}>Love at First Spike</h1>
          <p style={{ color: "#cbd5e1", lineHeight: 1.5 }}>
            Set up your match: choose the rules, list each team's players, pick the starting six
            and the libero, then confirm to begin.
          </p>
        </div>
        <CutoutSlideshow />
      </div>

      {sectionTitle("1 · Match rules")}
      <RulesCard match={match} dispatch={dispatch} />

      {sectionTitle("2 · Teams, players and libero")}
      <div style={{ display: "flex", justifyContent: "center", gap: 24, flexWrap: "wrap" }}>
        <TeamSetup team={0} match={match} dispatch={dispatch} />
        <TeamSetup team={1} match={match} dispatch={dispatch} />
      </div>

      <div style={{ textAlign: "center", marginTop: 32, paddingBottom: 24 }}>
        <button
          onClick={() => dispatch({ type: "START_MATCH" })}
          disabled={!ready}
          style={{
            padding: "14px 40px",
            fontSize: 20,
            fontWeight: "bold",
            borderRadius: 10,
            border: "none",
            background: ready ? "#22c55e" : "#475569",
            color: ready ? "#052e16" : "#cbd5e1",
            cursor: ready ? "pointer" : "not-allowed",
          }}
        >
          ✔ Confirm and start match
        </button>
        {!ready && (
          <div style={{ marginTop: 10, fontSize: 13, color: "#fca5a5" }}>
            Fix the red items above to continue.
          </div>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// MATCH PAGE
// =====================================================================

function TimeoutOverlay({ match, dispatch }) {
  const t = match.activeTimeout;
  const endsAt = t ? t.endsAt : null;
  const [now, setNow] = useState(Date.now());
  const beeped = useRef(false);

  useEffect(() => {
    if (endsAt === null) return undefined;
    beeped.current = Date.now() >= endsAt; // no beep if it already ended before a refresh
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [endsAt]);

  const msLeft = endsAt === null ? 0 : Math.max(0, endsAt - now);
  const done = t !== null && msLeft === 0;

  useEffect(() => {
    if (t && done && !beeped.current) {
      beeped.current = true;
      beep();
    }
  }, [t, done]);

  if (!t) return null;

  const total = match.rules.timeoutSeconds * 1000;
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(1, msLeft / total);
  const color = COLORS[t.team];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2, 6, 23, 0.9)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10,
      }}
    >
      <div style={{ fontSize: 20, marginBottom: 16, color }}>{match.names[t.team]} timeout</div>

      <div style={{ position: "relative", width: 180, height: 180 }}>
        <svg width="180" height="180" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="90" cy="90" r={radius} fill="none" stroke="#334155" strokeWidth="10" />
          <circle
            cx="90"
            cy="90"
            r={radius}
            fill="none"
            stroke={done ? "#ef4444" : color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
          />
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 44,
            fontWeight: "bold",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatTime(Math.ceil(msLeft / 1000))}
        </div>
      </div>

      <div style={{ height: 28, marginTop: 16, fontSize: 18 }}>{done ? "Time's up!" : ""}</div>

      <button
        onClick={() => dispatch({ type: "END_TIMEOUT" })}
        style={{
          marginTop: 8,
          padding: "12px 32px",
          fontSize: 18,
          borderRadius: 8,
          border: "none",
          background: done ? "#ef4444" : "#f8fafc",
          color: done ? "white" : "#0f172a",
          fontWeight: "bold",
          cursor: "pointer",
        }}
      >
        {done ? "Resume play" : "End timeout early"}
      </button>
    </div>
  );
}

function ServeBall() {
  return (
    <div className="ballIn" role="img" aria-label="Serving">
      <div className="ballBounce">
        <span className="ballSpin">🏐</span>
      </div>
      <div className="ballShadow" />
    </div>
  );
}

// Court with animated rotation. Tap a player to start a substitution or a libero move.
function Court({ team, match, selection, onPick, canSub }) {
  const lineup = match.lineups[team];
  const color = COLORS[team];
  const lib = match.libero[team];
  const cover = match.liberoCover[team];
  const sel = selection && selection.team === team ? selection : null;

  const width = 3 * TILE + 2 * GAP;
  const height = 2 * TILE + GAP;

  return (
    <div>
      <div
        style={{
          borderTop: "3px solid #94a3b8",
          width,
          margin: "0 auto 10px",
          fontSize: 11,
          color: "#94a3b8",
          paddingTop: 4,
          letterSpacing: 2,
        }}
      >
        NET
      </div>

      <div style={{ position: "relative", width, height, margin: "0 auto" }}>
        {Object.entries(SLOT_POS).map(([pos, [col, row]]) => (
          <div
            key={pos}
            style={{
              position: "absolute",
              left: col * (TILE + GAP),
              top: row * (TILE + GAP),
              width: TILE,
              height: TILE,
              borderRadius: 8,
              border: "1px dashed #475569",
            }}
          />
        ))}

        {/* Players are keyed by id, so they glide from slot to slot when the lineup rotates */}
        {lineup.map((p, k) => {
          const pos = k + 1;
          const [col, row] = SLOT_POS[pos];
          const isLibero = !!lib && p.id === lib.id;
          const selected = !!sel && sel.kind === "court" && sel.index === k && !isLibero;

          let target = false;
          if (canSub && sel) {
            if (sel.kind === "reserve") target = !isLibero;
            if (sel.kind === "libero") target = canLiberoEnter(match, team, k);
          }

          const border = selected
            ? "2px solid #facc15"
            : isLibero
            ? "2px solid #22d3ee"
            : pos === 1
            ? `2px solid ${color}`
            : "2px solid transparent";

          return (
            <div
              key={p.id}
              className="tile"
              style={{
                left: col * (TILE + GAP),
                top: row * (TILE + GAP),
                width: TILE,
                height: TILE,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 3,
                  left: 7,
                  fontSize: 10,
                  color: "#94a3b8",
                  pointerEvents: "none",
                  zIndex: 1,
                }}
              >
                {pos}
              </span>
              {isLibero && (
                <span
                  style={{
                    position: "absolute",
                    top: 3,
                    right: 7,
                    fontSize: 10,
                    fontWeight: "bold",
                    color: "#67e8f9",
                    pointerEvents: "none",
                    zIndex: 1,
                  }}
                >
                  L
                </span>
              )}
              <div
                className={target ? "target" : undefined}
                title={isLibero ? "Tap to take the libero off" : p.label}
                onClick={() => canSub && onPick({ team, kind: "court", index: k })}
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: 8,
                  border,
                  background: isLibero ? "#0e7490" : "#334155",
                  color: "white",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 4,
                  lineHeight: 1.1,
                  textAlign: "center",
                  overflowWrap: "anywhere",
                  fontSize: labelFontSize(p.label),
                  cursor: canSub ? "pointer" : "default",
                  boxShadow: selected ? "0 0 0 3px rgba(250,204,21,.4)" : undefined,
                }}
              >
                <span>{p.label}</span>
                {isLibero && cover && (
                  <span style={{ fontSize: 9, color: "#a5f3fc", marginTop: 2 }}>for {cover.label}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Libero tile and reserve (substitution) panel beside the court.
function Reserves({ team, match, selection, onPick, canSub }) {
  const reserves = match.reserves[team];
  const lib = match.libero[team];
  const cover = match.liberoCover[team];
  const libOnCourt = !!cover;
  const sel = selection && selection.team === team ? selection : null;

  return (
    <div style={{ width: 92 }}>
      {lib && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, letterSpacing: 2, color: "#67e8f9", marginBottom: 8 }}>LIBERO</div>
          <div className="pop">
            <div
              onClick={() => canSub && !libOnCourt && onPick({ team, kind: "libero", index: 0 })}
              title={libOnCourt ? "The libero is on court" : "Tap, then tap a back-row player"}
              style={{
                width: 88,
                minHeight: 52,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                padding: 4,
                borderRadius: 8,
                background: libOnCourt ? "#164e63" : "#0e7490",
                border:
                  sel && sel.kind === "libero" ? "2px solid #facc15" : "2px solid #22d3ee",
                color: "white",
                fontSize: labelFontSize(lib.label),
                lineHeight: 1.1,
                overflowWrap: "anywhere",
                opacity: libOnCourt ? 0.55 : 1,
                cursor: canSub && !libOnCourt ? "pointer" : "default",
                boxShadow:
                  sel && sel.kind === "libero" ? "0 0 0 3px rgba(250,204,21,.4)" : undefined,
              }}
            >
              {lib.label}
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
              {libOnCourt ? `On court for ${cover.label}` : "On the bench"}
            </div>
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, letterSpacing: 2, color: "#94a3b8", marginBottom: 8 }}>RESERVES</div>
      <div style={{ display: "flex", flexDirection: "column", gap: GAP }}>
        {reserves.length === 0 && <div style={{ fontSize: 12, color: "#94a3b8" }}>No reserves</div>}
        {reserves.map((p, i) => {
          const selected = !!sel && sel.kind === "reserve" && sel.index === i;
          const target = canSub && !!sel && sel.kind === "court";
          return (
            <div key={p.id} className="pop">
              <div
                className={target ? "target" : undefined}
                title={p.label}
                onClick={() => canSub && onPick({ team, kind: "reserve", index: i })}
                style={{
                  width: 88,
                  minHeight: 52,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  padding: 4,
                  borderRadius: 8,
                  background: "#334155",
                  border: selected ? "2px solid #facc15" : "2px solid transparent",
                  color: "white",
                  fontSize: labelFontSize(p.label),
                  lineHeight: 1.1,
                  overflowWrap: "anywhere",
                  cursor: canSub ? "pointer" : "default",
                  boxShadow: selected ? "0 0 0 3px rgba(250,204,21,.4)" : undefined,
                }}
              >
                {p.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TeamCard({ team, match, dispatch, selection, onPick }) {
  const color = COLORS[team];
  const finished = match.winner !== null;
  const fresh = isSetFresh(match);
  const serving = match.serving === team;
  const left = match.timeouts[team];
  const lib = match.libero[team];
  const [swoosh, setSwoosh] = useState(0);

  const pointsOff = finished || !!match.activeTimeout;
  const timeoutOff = finished || left === 0 || !!match.activeTimeout;
  const canSub = !finished && !match.activeTimeout;
  const sel = selection && selection.team === team ? selection : null;

  const addPoint = () => {
    setSwoosh((n) => n + 1); // restarts the swoosh animation
    dispatch({ type: "POINT", team });
  };

  let hint = "";
  if (canSub) {
    if (!sel) {
      hint = lib
        ? "Substitute: tap a court player, then a reserve. Libero: tap the libero, then a back-row player."
        : "To substitute: tap a court player, then a reserve.";
    } else if (sel.kind === "court") hint = "Now tap a reserve to swap in.";
    else if (sel.kind === "reserve") hint = "Now tap the court player to swap out.";
    else hint = "Now tap a back-row player (positions 5, 6 or 1) to replace. The libero cannot serve.";
  }

  return (
    <div
      style={{
        background: CARD_BG,
        borderRadius: 16,
        padding: 24,
        width: 400,
        maxWidth: "100%",
        borderTop: `4px solid ${color}`,
      }}
    >
      <input
        value={match.names[team]}
        onChange={(e) => dispatch({ type: "SET_NAME", team, name: e.target.value })}
        style={{
          width: "100%",
          fontSize: 22,
          textAlign: "center",
          padding: 8,
          borderRadius: 8,
          border: "none",
          background: "#334155",
          color: "white",
        }}
      />

      <div
        key={match.points[team]}
        className="scorePop"
        style={{ fontSize: 96, fontWeight: "bold", lineHeight: 1, margin: "20px 0" }}
      >
        {match.points[team]}
      </div>

      <div style={{ marginBottom: 8 }}>Sets won: {match.sets[team]}</div>

      {/* The serving ball lives on whichever side is serving */}
      <div
        style={{
          height: 64,
          marginBottom: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
        }}
      >
        {serving && !finished && (
          <>
            <ServeBall />
            <span style={{ fontSize: 13, letterSpacing: 2, color }}>SERVING</span>
          </>
        )}
        {!serving && fresh && (
          <button
            onClick={() => dispatch({ type: "SET_FIRST_SERVER", team })}
            style={{
              padding: "4px 12px",
              borderRadius: 6,
              border: "1px solid #64748b",
              background: "transparent",
              color: "white",
              cursor: "pointer",
            }}
          >
            Serve first
          </button>
        )}
      </div>

      <button
        className="pointBtn"
        onClick={addPoint}
        disabled={pointsOff}
        style={{
          fontSize: 22,
          padding: "10px 28px",
          borderRadius: 8,
          border: "none",
          background: color,
          color: "#0f172a",
          fontWeight: "bold",
          cursor: pointsOff ? "not-allowed" : "pointer",
          opacity: pointsOff ? 0.4 : 1,
        }}
      >
        <span style={{ position: "relative" }}>+ Point</span>
        {swoosh > 0 && <span key={swoosh} className="swoosh" />}
      </button>

      <div style={{ marginTop: 16 }}>
        <button
          onClick={() => dispatch({ type: "TIMEOUT", team, now: Date.now() })}
          disabled={timeoutOff}
          style={{
            padding: "8px 18px",
            fontSize: 15,
            borderRadius: 8,
            border: `1px solid ${color}`,
            background: "transparent",
            color: "white",
            cursor: timeoutOff ? "not-allowed" : "pointer",
            opacity: timeoutOff ? 0.4 : 1,
          }}
        >
          ⏱ Timeout
        </button>
        <div style={{ marginTop: 8, display: "flex", gap: 6, justifyContent: "center" }}>
          {Array.from({ length: match.rules.timeoutsPerSet }).map((_, i) => (
            <span
              key={i}
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: i < left ? color : "#475569",
              }}
            />
          ))}
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
          {left} timeout{left === 1 ? "" : "s"} left this set
        </div>
      </div>

      {/* Court on the left, libero and reserves beside it */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 20,
          justifyContent: "center",
          alignItems: "flex-start",
          marginTop: 24,
        }}
      >
        <Court team={team} match={match} selection={selection} onPick={onPick} canSub={canSub} />
        <Reserves team={team} match={match} selection={selection} onPick={onPick} canSub={canSub} />
      </div>

      <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 12, minHeight: 32 }}>{hint}</div>
      <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 4 }}>
        Substitutions this set: {match.subsUsed[team]}
        {lib ? " · libero moves are free" : ""}
      </div>
    </div>
  );
}

function SetHistory({ match }) {
  return (
    <div style={{ marginTop: 32 }}>
      <h3 style={{ marginBottom: 12 }}>Set history</h3>
      {match.setHistory.length === 0 ? (
        <div style={{ color: "#cbd5e1" }}>No sets finished yet.</div>
      ) : (
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          {match.setHistory.map((s) => (
            <div
              key={s.set}
              style={{
                background: CARD_BG,
                borderRadius: 10,
                padding: "10px 16px",
                borderBottom: `3px solid ${COLORS[s.winner]}`,
              }}
            >
              <div style={{ fontSize: 12, color: "#94a3b8" }}>Set {s.set}</div>
              <div style={{ fontSize: 22, fontWeight: "bold" }}>
                {s.points[0]} – {s.points[1]}
              </div>
              <div style={{ fontSize: 12 }}>{match.names[s.winner]}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MatchPage({ match, dispatch }) {
  const [selection, setSelection] = useState(null); // { team, kind: "court" | "reserve" | "libero", index }

  // A half-finished substitution is cancelled whenever the game moves on.
  const p0 = match.points[0];
  const p1 = match.points[1];
  const timeoutOn = match.activeTimeout !== null;
  useEffect(() => {
    setSelection(null);
  }, [p0, p1, match.currentSet, timeoutOn]);

  // Tap two tiles of the same team to swap them.
  const pick = (next) => {
    const { team, kind, index } = next;
    const lib = match.libero[team];

    // Tapping the libero while they are on court sends them off again.
    if (kind === "court" && lib && match.lineups[team][index].id === lib.id) {
      dispatch({ type: "LIBERO_OUT", team });
      setSelection(null);
      return;
    }

    if (!selection || selection.team !== team) {
      setSelection(next);
      return;
    }

    if (selection.kind === kind) {
      setSelection(selection.index === index ? null : next);
      return;
    }

    const kinds = [selection.kind, kind];
    const courtPick = selection.kind === "court" ? selection : next;

    if (kinds.includes("libero")) {
      if (!kinds.includes("court")) {
        setSelection(next); // libero + reserve is not a valid pair
        return;
      }
      if (canLiberoEnter(match, team, courtPick.index)) {
        dispatch({ type: "LIBERO_IN", team, courtIndex: courtPick.index });
        setSelection(null);
      }
      return; // illegal spot (front row or serving position): keep the selection
    }

    const reservePick = selection.kind === "reserve" ? selection : next;
    dispatch({
      type: "SUBSTITUTE",
      team,
      courtIndex: courtPick.index,
      reserveIndex: reservePick.index,
    });
    setSelection(null);
  };

  const finished = match.winner !== null;
  const cannotUndo = match.history.length === 0 || !!match.activeTimeout;

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 8 }}>Love at First Spike</h1>

      {finished ? (
        <h2 style={{ marginBottom: 24 }}>
          🏆 {match.names[match.winner]} wins {match.sets[match.winner]}–{match.sets[1 - match.winner]}
        </h2>
      ) : (
        <div style={{ marginBottom: 24, color: "#cbd5e1" }}>
          Best of {match.rules.bestOf} ·{" "}
          {isDecidingSet(match) ? "Deciding set" : `Set ${match.currentSet}`} · first to{" "}
          {pointsToWin(match)}, win by {match.rules.minLead}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "center", gap: 24, flexWrap: "wrap" }}>
        <TeamCard team={0} match={match} dispatch={dispatch} selection={selection} onPick={pick} />
        <TeamCard team={1} match={match} dispatch={dispatch} selection={selection} onPick={pick} />
      </div>

      <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 32, flexWrap: "wrap" }}>
        <button
          onClick={() => dispatch({ type: "UNDO" })}
          disabled={cannotUndo}
          style={{
            padding: "10px 24px",
            borderRadius: 8,
            border: "1px solid #64748b",
            background: "transparent",
            color: "white",
            cursor: cannotUndo ? "not-allowed" : "pointer",
            opacity: cannotUndo ? 0.4 : 1,
          }}
        >
          ↶ Undo
        </button>
        <button
          onClick={() => {
            if (window.confirm("Go back to setup? The current match will be cleared.")) {
              dispatch({ type: "RESET" });
            }
          }}
          style={{
            padding: "10px 24px",
            borderRadius: 8,
            border: "1px solid #64748b",
            background: "transparent",
            color: "white",
            cursor: "pointer",
          }}
        >
          ← Back to setup
        </button>
      </div>

      <SetHistory match={match} />

      <TimeoutOverlay match={match} dispatch={dispatch} />
    </div>
  );
}

export default function App() {
  const [match, dispatch] = useReducer(reducer, null, loadMatch);

  // Save after every change.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(match));
    } catch {
      /* storage full or blocked: ignore */
    }
  }, [match]);

  return (
    <>
      <style>{CSS}</style>
      {match.started ? (
        <MatchPage match={match} dispatch={dispatch} />
      ) : (
        <SetupPage match={match} dispatch={dispatch} />
      )}
    </>
  );
}
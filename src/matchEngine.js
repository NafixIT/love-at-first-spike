// src/matchEngine.js
// Pure match logic: no React and no browser code in this file.
// Every change goes through reducer(state, action) and returns a NEW state.

export const DEFAULT_RULES = {
  bestOf: 3, // odd number of sets: 1, 3, 5, 7 or 9
  setPoints: 25, // points to win a normal set
  decidingPoints: 15, // points to win the last (deciding) set
  minLead: 2, // win by 2
  timeoutsPerSet: 2, // per team, refilled at the start of every set
  timeoutSeconds: 120, // 2 minutes
};

export const LIMITS = {
  bestOf: [1, 9],
  setPoints: [5, 50],
  decidingPoints: [5, 50],
  timeoutsPerSet: [0, 4],
  timeoutSeconds: [10, 300],
};

export const MAX_LABEL = 12; // longest allowed jersey number or player name
export const MAX_ROSTER = 20; // players per team
export const FRONT_ROW = [1, 2, 3]; // lineup indexes of positions 2, 3, 4
export const BACK_ROW = [0, 4, 5]; // lineup indexes of positions 1, 5, 6

const DEFAULT_NAMES = ["Team A", "Team B"];
const EXAMPLES = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
  ["11", "12", "13", "14", "15", "16", "17", "18", "19"],
];

function clampTo([min, max], value) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

// Merge a patch into the rules, clamping every number to its allowed range.
function sanitizeRules(current, patch) {
  const next = { ...current };
  Object.keys(LIMITS).forEach((key) => {
    if (patch && key in patch && Number.isFinite(Number(patch[key]))) {
      next[key] = clampTo(LIMITS[key], Number(patch[key]));
    }
  });
  if (next.bestOf % 2 === 0) next.bestOf += 1; // always an odd number of sets
  return next;
}

export function setsToWin(rules) {
  return Math.ceil(rules.bestOf / 2);
}

// Replace one team's entry in a two-item array.
function setTeam(list, team, value) {
  return list.map((x, t) => (t === team ? value : x));
}

// roster = [teamA players, teamB players]
function copyRoster(roster) {
  return roster.map((list) => list.map((p) => ({ ...p })));
}

// Swap the court player at courtIndex with the reserve at reserveIndex.
function swapIn(lineup, reserves, courtIndex, reserveIndex) {
  return [
    lineup.map((p, i) => (i === courtIndex ? reserves[reserveIndex] : p)),
    reserves.map((p, i) => (i === reserveIndex ? lineup[courtIndex] : p)),
  ];
}

// lineup[0] is the player in position 1 (the server) ... lineup[5] is position 6.
// Clockwise rotation: 2->1, 1->6, 6->5, 5->4, 4->3, 3->2
export function rotate(lineup) {
  return lineup.map((_, k) => lineup[(k + 1) % 6]);
}

// "4, 5, 77 , 11, Sam" -> ["4", "5", "77", "11", "Sam"]
export function parseRoster(text) {
  return String(text)
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function findDuplicates(labels) {
  const seen = new Set();
  const dup = [];
  labels.forEach((l) => {
    const key = l.toLowerCase();
    if (seen.has(key) && !dup.includes(l)) dup.push(l);
    seen.add(key);
  });
  return dup;
}

const emptyCourt = () => ["", "", "", "", "", ""];

export function createMatch({ rules, names, setup } = {}) {
  const r = { ...DEFAULT_RULES, ...(rules || {}) };
  return {
    rules: r,
    names: names ? [...names] : [...DEFAULT_NAMES],
    started: false, // false = the setup page is showing
    // Setup page data. court[team][i] is the label chosen for position i + 1.
    setup: setup
      ? JSON.parse(JSON.stringify(setup))
      : {
          rosterText: ["", ""],
          court: [emptyCourt(), emptyCourt()],
          libero: ["", ""],
        },
    // Match data: filled in when the match starts.
    lineups: [[], []], // players on court right now
    startLineups: [[], []], // court lineup at the start of each set
    reserves: [[], []], // bench players right now
    startReserves: [[], []], // bench at the start of each set
    libero: [null, null], // each team's libero player, or null
    liberoCover: [null, null], // the player the libero replaced, while the libero is on court
    subsUsed: [0, 0], // substitutions made this set
    points: [0, 0],
    sets: [0, 0],
    setHistory: [], // [{ set, points: [a, b], winner }]
    currentSet: 1,
    serving: 0,
    firstServer: 0,
    winner: null,
    timeouts: [r.timeoutsPerSet, r.timeoutsPerSet], // timeouts left this set
    activeTimeout: null, // { team, endsAt } while a timeout is running
    history: [], // undo stack: one snapshot per point, substitution or libero move
  };
}

// Checks a saved match from localStorage so a damaged save never crashes the app.
export function isValidMatch(m) {
  try {
    const player = (p) => p && typeof p.id === "number" && typeof p.label === "string";
    const lineup = (l) => Array.isArray(l) && l.length === 6 && l.every((p) => player(p));
    const list = (l) => Array.isArray(l) && l.every((p) => player(p));
    const pair = (a, f) => Array.isArray(a) && a.length === 2 && a.every((x) => f(x));
    const text = (t) => typeof t === "string";
    const six = (c) => Array.isArray(c) && c.length === 6 && c.every(text);

    if (!m || !m.rules || typeof m.rules.bestOf !== "number") return false;
    if (typeof m.started !== "boolean") return false;
    if (!m.setup || !pair(m.setup.rosterText, text)) return false;
    if (!pair(m.setup.court, six) || !pair(m.setup.libero, text)) return false;
    if (!pair(m.names, text)) return false;
    if (
      !Array.isArray(m.points) ||
      !Array.isArray(m.sets) ||
      !Array.isArray(m.timeouts) ||
      !Array.isArray(m.subsUsed) ||
      !Array.isArray(m.history)
    ) {
      return false;
    }
    if (!m.started) return true;
    return (
      pair(m.lineups, lineup) &&
      pair(m.startLineups, lineup) &&
      pair(m.reserves, list) &&
      pair(m.startReserves, list) &&
      pair(m.libero, (p) => p === null || player(p)) &&
      pair(m.liberoCover, (p) => p === null || player(p))
    );
  } catch {
    return false;
  }
}

export function isDecidingSet(state) {
  return state.rules.bestOf > 1 && state.currentSet === state.rules.bestOf;
}

export function pointsToWin(state) {
  return isDecidingSet(state) ? state.rules.decidingPoints : state.rules.setPoints;
}

// True before the first point of a set.
export function isSetFresh(state) {
  return state.winner === null && state.points[0] === 0 && state.points[1] === 0;
}

// What still has to be fixed before the match can start. One list of messages per team.
export function setupProblems(state) {
  return [0, 1].map((team) => {
    const problems = [];
    const labels = parseRoster(state.setup.rosterText[team]);
    const court = state.setup.court[team];
    const libero = state.setup.libero[team];

    if (labels.length === 0) {
      problems.push("Enter the players' jersey numbers or names, separated by commas.");
      return problems;
    }
    if (labels.length > MAX_ROSTER) problems.push(`At most ${MAX_ROSTER} players per team.`);

    const tooLong = labels.filter((l) => l.length > MAX_LABEL);
    if (tooLong.length > 0) {
      problems.push(`Too long (max ${MAX_LABEL} characters): ${tooLong.join(", ")}.`);
    }

    const dup = findDuplicates(labels);
    if (dup.length > 0) problems.push(`Listed more than once: ${dup.join(", ")}.`);

    const needed = libero ? 7 : 6;
    if (labels.length < needed) {
      problems.push(
        libero
          ? "Need at least 7 players: 6 on court plus the libero."
          : "Need at least 6 players."
      );
    }

    const chosen = court.filter(Boolean).length;
    if (chosen < 6) problems.push(`Choose a player for every court position (${chosen} of 6).`);

    return problems;
  });
}

// Libero rules (FIVB): the libero may only replace a BACK-row player (positions 1, 5, 6),
// cannot serve, and replacements are free and unlimited (they are not substitutions).
export function canLiberoEnter(state, team, courtIndex) {
  if (!state.started || state.winner !== null || state.activeTimeout) return false;
  if (!state.libero[team] || state.liberoCover[team]) return false; // no libero, or already on court
  if (!BACK_ROW.includes(courtIndex)) return false;
  if (courtIndex === 0 && state.serving === team) return false; // position 1 of the serving team serves
  return true;
}

// A copy of the match without its undo stack.
function snapshot(state) {
  const { history, ...rest } = state;
  return JSON.parse(JSON.stringify(rest));
}

// If the libero has rotated into the front row (or onto the serving spot), the player
// the libero replaced comes back on automatically.
function fixLibero(state, team) {
  const libero = state.libero[team];
  const cover = state.liberoCover[team];
  if (!libero || !cover) return state;

  const lineup = state.lineups[team];
  const idx = lineup.findIndex((p) => p.id === libero.id);
  if (idx === -1) return state;

  const inFrontRow = FRONT_ROW.includes(idx);
  const wouldServe = idx === 0 && state.serving === team;
  if (!inFrontRow && !wouldServe) return state;

  return {
    ...state,
    lineups: setTeam(state.lineups, team, lineup.map((p, i) => (i === idx ? cover : p))),
    liberoCover: setTeam(state.liberoCover, team, null),
  };
}

// Update one team's part of the setup page data.
function withSetup(state, team, patch) {
  const s = state.setup;
  return {
    ...state,
    setup: {
      rosterText:
        patch.rosterText !== undefined ? setTeam(s.rosterText, team, patch.rosterText) : s.rosterText,
      court: patch.court !== undefined ? setTeam(s.court, team, patch.court) : s.court,
      libero: patch.libero !== undefined ? setTeam(s.libero, team, patch.libero) : s.libero,
    },
  };
}

// Turn the setup page data for one team into real players.
function buildTeam(setup, team) {
  const players = parseRoster(setup.rosterText[team]).map((label, id) => ({ id, label }));
  const find = (label) => players.find((p) => p.label === label);
  const lineup = setup.court[team].map(find);
  const lib = setup.libero[team] ? find(setup.libero[team]) || null : null;
  const onCourt = new Set(lineup.filter(Boolean).map((p) => p.id));
  const reserves = players.filter((p) => !onCourt.has(p.id) && !(lib && p.id === lib.id));
  return { lineup, lib, reserves };
}

function scorePoint(state, team) {
  if (!state.started || state.winner !== null || state.activeTimeout) return state;

  const other = 1 - team;
  const history = [...state.history, snapshot(state)];

  const points = [...state.points];
  points[team] += 1;

  let next = { ...state, points, history };

  // Side-out: the receiving team won the rally, so it rotates and takes the serve.
  if (state.serving !== team) {
    next = {
      ...next,
      lineups: state.lineups.map((l, t) => (t === team ? rotate(l) : l)),
      serving: team,
    };
    next = fixLibero(next, team); // libero leaves the front row / serving spot
  }

  const target = pointsToWin(state);
  const wonSet =
    points[team] >= target && points[team] - points[other] >= state.rules.minLead;

  if (!wonSet) return next;

  const sets = [...state.sets];
  sets[team] += 1;
  const setHistory = [...state.setHistory, { set: state.currentSet, points, winner: team }];

  // Match over: keep the final set score on screen.
  if (sets[team] >= setsToWin(state.rules)) {
    return { ...next, sets, setHistory, winner: team };
  }

  // New set: scores reset, court and bench go back to the start-of-set roster, the libero
  // starts on the bench again, timeouts are refilled and the first serve alternates.
  const nextFirstServer = 1 - state.firstServer;
  return {
    ...next,
    sets,
    setHistory,
    currentSet: state.currentSet + 1,
    points: [0, 0],
    lineups: copyRoster(state.startLineups),
    reserves: copyRoster(state.startReserves),
    liberoCover: [null, null],
    subsUsed: [0, 0],
    serving: nextFirstServer,
    firstServer: nextFirstServer,
    timeouts: [state.rules.timeoutsPerSet, state.rules.timeoutsPerSet],
  };
}

export function reducer(state, action) {
  switch (action.type) {
    // ---------- Setup page ----------
    case "SET_RULES": {
      if (state.started) return state;
      const rules = sanitizeRules(state.rules, action.rules);
      return { ...state, rules, timeouts: [rules.timeoutsPerSet, rules.timeoutsPerSet] };
    }

    case "SET_NAME":
      return {
        ...state,
        names: state.names.map((n, i) =>
          i === action.team ? action.name.slice(0, 24) : n
        ),
      };

    case "SET_ROSTER": {
      if (state.started) return state;
      const { team } = action;
      const text = String(action.text).slice(0, 400);
      const labels = parseRoster(text);
      const keep = (l) => labels.includes(l);
      return withSetup(state, team, {
        rosterText: text,
        court: state.setup.court[team].map((c) => (keep(c) ? c : "")),
        libero: keep(state.setup.libero[team]) ? state.setup.libero[team] : "",
      });
    }

    case "SET_COURT": {
      if (state.started) return state;
      const { team, index, value } = action;
      if (value !== "" && !parseRoster(state.setup.rosterText[team]).includes(value)) return state;
      const court = state.setup.court[team].map((c, i) =>
        i === index ? value : value !== "" && c === value ? "" : c
      );
      const libero = state.setup.libero[team] === value ? "" : state.setup.libero[team];
      return withSetup(state, team, { court, libero });
    }

    case "SET_LIBERO": {
      if (state.started) return state;
      const { team, value } = action;
      if (value !== "" && !parseRoster(state.setup.rosterText[team]).includes(value)) return state;
      const court = state.setup.court[team].map((c) => (value !== "" && c === value ? "" : c));
      return withSetup(state, team, { libero: value, court });
    }

    // Fill the six court positions with the first six players (not the libero), in list order.
    case "AUTO_FILL": {
      if (state.started) return state;
      const { team } = action;
      const labels = parseRoster(state.setup.rosterText[team]);
      const libero = state.setup.libero[team];
      const pool = labels.filter((l, i) => l !== libero && labels.indexOf(l) === i);
      return withSetup(state, team, {
        court: Array.from({ length: 6 }, (_, i) => pool[i] || ""),
      });
    }

    case "FILL_EXAMPLE": {
      if (state.started) return state;
      const labels = EXAMPLES[action.team];
      return withSetup(state, action.team, {
        rosterText: labels.join(", "),
        court: labels.slice(0, 6),
        libero: labels[labels.length - 1],
      });
    }

    // Confirm: builds the real players from the setup page and begins the match.
    case "START_MATCH": {
      if (state.started) return state;
      if (setupProblems(state).some((list) => list.length > 0)) return state;
      const built = [0, 1].map((t) => buildTeam(state.setup, t));
      if (built.some((b) => b.lineup.length !== 6 || b.lineup.some((p) => !p))) return state;

      const lineups = built.map((b) => b.lineup);
      const reserves = built.map((b) => b.reserves);
      return {
        ...state,
        started: true,
        names: state.names.map((n, i) => n.trim() || DEFAULT_NAMES[i]),
        lineups: copyRoster(lineups),
        startLineups: copyRoster(lineups),
        reserves: copyRoster(reserves),
        startReserves: copyRoster(reserves),
        libero: built.map((b) => (b.lib ? { ...b.lib } : null)),
        liberoCover: [null, null],
        subsUsed: [0, 0],
        timeouts: [state.rules.timeoutsPerSet, state.rules.timeoutsPerSet],
        points: [0, 0],
        sets: [0, 0],
        setHistory: [],
        currentSet: 1,
        winner: null,
        activeTimeout: null,
        history: [],
      };
    }

    case "SET_FIRST_SERVER":
      if (!isSetFresh(state)) return state;
      return fixLibero(
        { ...state, serving: action.team, firstServer: action.team },
        action.team
      );

    // ---------- Match ----------
    case "POINT":
      return scorePoint(state, action.team);

    case "UNDO": {
      if (state.history.length === 0 || state.activeTimeout) return state;
      const last = state.history[state.history.length - 1];
      return {
        ...last,
        names: state.names, // undo never reverts a rename
        rules: state.rules,
        // Timeouts already taken stay taken, unless undo goes back into the previous set.
        timeouts: last.currentSet === state.currentSet ? state.timeouts : last.timeouts,
        activeTimeout: null,
        history: state.history.slice(0, -1),
      };
    }

    case "TIMEOUT": {
      const { team, now } = action;
      if (
        !state.started ||
        state.winner !== null ||
        state.activeTimeout ||
        state.timeouts[team] <= 0
      ) {
        return state;
      }
      const timeouts = [...state.timeouts];
      timeouts[team] -= 1;
      return {
        ...state,
        timeouts,
        activeTimeout: { team, endsAt: now + state.rules.timeoutSeconds * 1000 },
      };
    }

    case "END_TIMEOUT":
      return state.activeTimeout ? { ...state, activeTimeout: null } : state;

    // Swap a court player with a reserve.
    case "SUBSTITUTE": {
      const { team, courtIndex, reserveIndex } = action;
      if (!state.started || state.winner !== null || state.activeTimeout) return state;
      const onCourt = state.lineups[team][courtIndex];
      if (!onCourt || !state.reserves[team][reserveIndex]) return state;
      // The libero is not substituted: tap the libero to take them off instead.
      if (state.libero[team] && onCourt.id === state.libero[team].id) return state;

      const [lineup, reserves] = swapIn(
        state.lineups[team],
        state.reserves[team],
        courtIndex,
        reserveIndex
      );
      const next = {
        ...state,
        lineups: setTeam(state.lineups, team, lineup),
        reserves: setTeam(state.reserves, team, reserves),
      };

      // Before the first point of a set this changes the starting lineup for this and later sets.
      if (isSetFresh(state)) {
        const [startLineup, startReserves] = swapIn(
          state.startLineups[team],
          state.startReserves[team],
          courtIndex,
          reserveIndex
        );
        return {
          ...next,
          startLineups: setTeam(state.startLineups, team, startLineup),
          startReserves: setTeam(state.startReserves, team, startReserves),
        };
      }

      // Mid-set: it counts as a substitution and can be undone.
      const subsUsed = [...state.subsUsed];
      subsUsed[team] += 1;
      return { ...next, subsUsed, history: [...state.history, snapshot(state)] };
    }

    // Libero comes on for a back-row player. Not counted as a substitution.
    case "LIBERO_IN": {
      const { team, courtIndex } = action;
      if (!canLiberoEnter(state, team, courtIndex)) return state;
      const libero = state.libero[team];
      const covered = state.lineups[team][courtIndex];
      const next = {
        ...state,
        lineups: setTeam(
          state.lineups,
          team,
          state.lineups[team].map((p, i) => (i === courtIndex ? libero : p))
        ),
        liberoCover: setTeam(state.liberoCover, team, covered),
      };
      return isSetFresh(state) ? next : { ...next, history: [...state.history, snapshot(state)] };
    }

    // Libero goes off; the player they replaced comes back into the same spot.
    case "LIBERO_OUT": {
      const { team } = action;
      if (!state.started || state.winner !== null || state.activeTimeout) return state;
      const libero = state.libero[team];
      const cover = state.liberoCover[team];
      if (!libero || !cover) return state;
      const idx = state.lineups[team].findIndex((p) => p.id === libero.id);
      if (idx === -1) return state;
      const next = {
        ...state,
        lineups: setTeam(
          state.lineups,
          team,
          state.lineups[team].map((p, i) => (i === idx ? cover : p))
        ),
        liberoCover: setTeam(state.liberoCover, team, null),
      };
      return isSetFresh(state) ? next : { ...next, history: [...state.history, snapshot(state)] };
    }

    // Back to the setup page (rules, names, players and libero are kept).
    case "RESET":
      return createMatch({ rules: state.rules, names: state.names, setup: state.setup });

    default:
      return state;
  }
}
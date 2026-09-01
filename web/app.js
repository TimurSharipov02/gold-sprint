console.log("GOLD SPRINT APP LOADED");


/* =========================
   ELEMENTS
   ========================= */

const raceScreen = document.getElementById("race-screen");
const setupScreen = document.getElementById("setup-screen");

const navRace = document.getElementById("nav-race");
const navSetup = document.getElementById("nav-setup");

const backButton = document.getElementById("back-button");

const startButton = document.getElementById("start-button");

const distanceSelect =
    document.getElementById("setup-distance");

const wheel1 =
    document.getElementById("wheel-1");

const wheel2 =
    document.getElementById("wheel-2");

const saveSettings =
    document.getElementById("save-settings");

const statusEl =
    document.getElementById("status");

const riderName1 =
    document.getElementById("rider-name-1");

const riderName2 =
    document.getElementById("rider-name-2");

const raceHeat =
    document.getElementById("race-heat");

const overlay =
    document.getElementById("overlay");

const overlayCountdown =
    document.getElementById("overlay-countdown");

const overlayResult =
    document.getElementById("overlay-result");

const overlayResultLabel =
    document.getElementById("overlay-result-label");

const overlayResultRider =
    document.getElementById("overlay-result-rider");

const overlayResultTime =
    document.getElementById("overlay-result-time");

const navTournament =
    document.getElementById("nav-tournament");

const tournamentScreen =
    document.getElementById("tournament-screen");

const tournamentBody =
    document.getElementById("tournament-body");

const tournamentSidebar =
    document.getElementById("tournament-sidebar");


/* =========================
   SETTINGS
   ========================= */

const settings = {

    distance: 250,

    wheels: {
        1: 2105,
        2: 2105
    }

};


// Which lanes are currently fed by a real Bluetooth sensor (set by ble.js).
const bleSources = { 1: false, 2: false };

// Small bridge for ble.js — it does the Web Bluetooth work and calls back here.
window.raceApp = {

    sendSensor(rider, speed, cadence, wheelRevs) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: "sensor",
                rider,
                speed,
                cadence,
                wheelRevs
            }));
        }
    },

    wheelCircumferenceMM(rider) {
        return settings.wheels[rider] || 2105;
    },

    get state() {
        return raceState;
    },

    setBleSource(rider, active) {
        bleSources[rider] = Boolean(active);

        // Tell the server right away so the lane's live readings show during the
        // pre-start check, not only once a race begins.
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: "source",
                rider,
                source: active ? "ble" : "mock"
            }));
        }
    }
};


// Authoritative race distance, kept in sync with the server so the progress
// bars match the distance the race is actually run at.
let raceDistance = settings.distance;

// Latest race state from the server. Distance and the progress bar only move
// once this is "running"; before that the screen still shows live speed/cadence
// for the pre-start sensor check.
let raceState = "ready";


/* =========================
   WEBSOCKET
   ========================= */

// socket is reassigned on every reconnect; the START handler and others read it
// through this binding so they always use the live connection.
let socket;


function connectSocket() {

    socket = new WebSocket(`ws://${location.host}/ws`);

    socket.onopen = () => {
        console.log("WEBSOCKET CONNECTED");
        statusEl.textContent = "READY";
        startButton.disabled = false;
    };

    socket.onclose = () => {
        console.log("WEBSOCKET CLOSED — reconnecting");
        statusEl.textContent = "СВЯЗЬ ПОТЕРЯНА — ПЕРЕПОДКЛЮЧЕНИЕ...";
        setTimeout(connectSocket, 2000);
    };

    socket.onerror = (error) => {
        console.error("WEBSOCKET ERROR", error);
    };

    socket.onmessage = (event) => {

        const data = JSON.parse(event.data);

        if (data.type === "race") {

            handleRaceData(data);

        } else {

            // A staged tournament heat freezes the screen until its own race
            // starts, so the previous race's final rider values don't repaint
            // over the reset.
            if (raceScreenStaged()) {
                return;
            }

            updateRider(data);
        }
    };
}


connectSocket();


// True while a tournament heat is set up but its race hasn't begun yet.
function raceScreenStaged() {
    return Boolean(tournament.heat) && !tournament.heat.armed;
}


/* =========================
   NAVIGATION
   ========================= */

let currentScreen = "race";


function showScreen(screen) {

    currentScreen = screen;

    raceScreen.classList.toggle(
        "hidden",
        screen !== "race"
    );

    setupScreen.classList.toggle(
        "hidden",
        screen !== "setup"
    );

    tournamentScreen.classList.toggle(
        "hidden",
        screen !== "tournament"
    );

    navRace.classList.toggle(
        "active",
        screen === "race"
    );

    navTournament.classList.toggle(
        "active",
        screen === "tournament"
    );

    navSetup.classList.toggle(
        "active",
        screen === "setup"
    );

    updateSidebar();
}


navRace.addEventListener(
    "click",
    () => showScreen("race")
);


navTournament.addEventListener(
    "click",
    () => showScreen("tournament")
);


navSetup.addEventListener(
    "click",
    () => showScreen("setup")
);


backButton.addEventListener(
    "click",
    () => showScreen("race")
);


/* =========================
   SAVE SETTINGS
   ========================= */

saveSettings.addEventListener(
    "click",
    () => {

        settings.distance =
            Number(distanceSelect.value);

        settings.wheels[1] =
            Number(wheel1.value);

        settings.wheels[2] =
            Number(wheel2.value);

        console.log(
            "SETTINGS SAVED",
            settings
        );

        raceDistance = settings.distance;

        updateRaceDistance();

        showScreen("race");
    }
);


function updateRaceDistance() {

    document.getElementById(
        "distance-limit-1"
    ).textContent =
        raceDistance;

    document.getElementById(
        "distance-limit-2"
    ).textContent =
        raceDistance;
}


/* =========================
   START RACE
   ========================= */

startButton.addEventListener(
    "click",
    () => {

        if (socket.readyState !== WebSocket.OPEN) {

            console.error(
                "WEBSOCKET IS NOT OPEN"
            );

            return;
        }

        const command = {

            type: "start",

            distance:
                tournament.heat
                    ? tournament.heat.distance
                    : settings.distance,

            wheel1:
                settings.wheels[1],

            wheel2:
                settings.wheels[2],

            source1:
                bleSources[1] ? "ble" : "mock",

            source2:
                bleSources[2] ? "ble" : "mock"

        };

        console.log(
            "SENDING START:",
            command
        );

        socket.send(
            JSON.stringify(command)
        );
    }
);


/* =========================
   RIDER DATA
   ========================= */

function updateRider(data) {

    const rider =
        data.rider;


    // Speed and cadence are always live, so a rider can spin up and check the
    // sensor / trainer before the start.
    document.getElementById(
        `speed-${rider}`
    ).textContent =
        data.speed.toFixed(1);


    document.getElementById(
        `cadence-${rider}`
    ).textContent =
        Math.round(data.cadence);


    // Distance and progress only count once the race is actually running — not
    // before START and not during the countdown.
    const counting =
        raceState === "running" || raceState === "finished";


    document.getElementById(
        `distance-${rider}`
    ).textContent =
        counting ? data.distance.toFixed(1) : "0.0";


    const progress =
        counting
            ? Math.min(data.distance / raceDistance * 100, 100)
            : 0;


    document.getElementById(
        `progress-${rider}`
    ).style.width =
        `${progress}%`;


    // The server reports which source each lane is running on this race.
    const tag = document.getElementById(`sensor-tag-${rider}`);
    if (tag && data.source === "ble") {
        tag.textContent = "◉ ЖИВОЙ ДАТЧИК";
        tag.hidden = false;
    } else if (tag && !bleSources[rider]) {
        tag.hidden = true;
    }
}


/* =========================
   OVERLAY (countdown / result)
   ========================= */

// The last countdown number rendered, so we only replay the pop animation when
// the value actually ticks over instead of on every 100ms race message.
let lastCountdownShown = null;

// Once the viewer taps the result away, the race stays in the "finished" state
// on the server, so this flag stops us from re-showing the overlay.
let resultDismissed = false;

// Same idea for the false-start overlay: the server keeps reporting the false
// start in the "ready" state until the next countdown clears it.
let falseStartDismissed = false;


function showCountdown(value) {

    overlay.classList.remove(
        "hidden",
        "is-result",
        "winner-1",
        "winner-2"
    );

    overlay.classList.add("is-countdown");

    overlayResult.classList.add("hidden");
    overlayCountdown.classList.remove("hidden");

    if (value === lastCountdownShown) {
        return;
    }

    lastCountdownShown = value;

    overlayCountdown.textContent = value;

    // Restart the pop animation by forcing a reflow between class toggles.
    overlayCountdown.classList.remove("tick");
    void overlayCountdown.offsetWidth;
    overlayCountdown.classList.add("tick");
}


// showResult drives the full-screen result overlay. colorLane (1 or 2, or null)
// picks the winner-coloured background; the three strings fill the label and the
// two big lines.
function showResult(colorLane, label, line1, line2) {

    overlay.classList.remove(
        "hidden",
        "is-countdown",
        "winner-1",
        "winner-2"
    );

    overlay.classList.add("is-result");

    if (colorLane === 1 || colorLane === 2) {
        overlay.classList.add(`winner-${colorLane}`);
    }

    overlayCountdown.classList.add("hidden");
    overlayResult.classList.remove("hidden");

    overlayResultLabel.textContent = label;
    overlayResultRider.textContent = line1;
    overlayResultTime.textContent = line2;
}


// showFalseStart drives the overlay when a rider jumps the countdown. The race
// drops back to READY and nothing is recorded — the start is simply re-run.
function showFalseStart(rider) {

    overlay.classList.remove(
        "hidden",
        "is-countdown",
        "is-result",
        "winner-1",
        "winner-2"
    );

    overlay.classList.add("is-falsestart");

    overlayCountdown.classList.add("hidden");
    overlayResult.classList.remove("hidden");

    const name = tournament.heat
        ? nameForHeatLane(rider)
        : `RIDER ${String(rider).padStart(2, "0")}`;

    overlayResultLabel.textContent = "ФАЛЬСТАРТ";
    overlayResultRider.textContent = name;
    overlayResultTime.textContent = "начал раньше — старт заново";
}


function nameForHeatLane(lane) {
    const id = lane === 1 ? tournament.heat.lane1 : tournament.heat.lane2;
    return id != null ? participantName(id) : `RIDER ${String(lane).padStart(2, "0")}`;
}


function hideOverlay() {

    overlay.classList.add("hidden");

    overlay.classList.remove(
        "is-countdown",
        "is-result",
        "is-falsestart",
        "winner-1",
        "winner-2"
    );

    lastCountdownShown = null;
}


overlay.addEventListener(
    "click",
    () => {

        if (overlay.classList.contains("is-falsestart")) {

            falseStartDismissed = true;
            hideOverlay();

            statusEl.textContent = tournament.heat
                ? `${heatRoundName()} — НАЖМИТЕ START`
                : "READY";

            return;
        }

        if (!overlay.classList.contains("is-result")) {
            return;
        }

        resultDismissed = true;

        hideOverlay();

        if (tournament.heat && tournament.heat.done) {
            endTournamentHeat();
        }
    }
);


/* =========================
   RACE DATA
   ========================= */

function handleRaceData(data) {

    raceDistance = data.distance;
    raceState = data.state;

    // Once a race is under way, trust the server's distance for the "/ N M"
    // labels. Before it, SETUP-save and the tournament heat set them.
    if (data.state !== "ready") {
        updateRaceDistance();
    }

    // While a heat is staged, the previous race's messages don't apply here.
    // Keep START available for this heat and ignore everything but the countdown
    // that means the heat's own race has begun.
    if (raceScreenStaged()) {

        startButton.disabled = false;
        distanceSelect.disabled = false;

        if (data.state !== "countdown") {
            return;
        }
    }


    switch (data.state) {

        case "ready":

            startButton.disabled =
                false;

            distanceSelect.disabled =
                false;

            if (data.falseStart > 0 && !falseStartDismissed) {

                statusEl.textContent =
                    `ФАЛЬСТАРТ · RIDER ${String(data.falseStart).padStart(2, "0")}`;

                showFalseStart(data.falseStart);

            } else {

                statusEl.textContent = "READY";
                resultDismissed = false;
                hideOverlay();
            }

            break;


        case "countdown":

            statusEl.textContent =
                "GET READY";

            startButton.disabled =
                true;

            distanceSelect.disabled =
                true;

            resultDismissed = false;
            falseStartDismissed = false;

            // A countdown only follows a fresh START, so this is the signal that
            // the tournament heat's own race has begun — from here its result
            // counts.
            if (tournament.heat) {
                tournament.heat.armed = true;
            }

            showCountdown(data.countdown);

            break;


        case "running":

            statusEl.textContent =
                `RUNNING // ${data.elapsed.toFixed(1)} S`;

            startButton.disabled =
                true;

            distanceSelect.disabled =
                true;

            hideOverlay();

            break;


        case "finished":

            startButton.disabled =
                false;

            distanceSelect.disabled =
                false;

            if (tournament.heat) {

                // Ignore the previous race's lingering "finished" messages until
                // this heat's own race has actually run.
                if (tournament.heat.armed) {
                    handleTournamentFinish(data);
                }

                break;
            }

            statusEl.textContent =
                `>>> RIDER ${data.winner} // ${data.elapsed.toFixed(2)} S <<<`;

            // Only pop the result over the race screen — never on top of the
            // tournament or setup tab from a race that finished in the background.
            if (!resultDismissed && currentScreen === "race") {

                showResult(
                    data.winner,
                    "WINNER",
                    `RIDER ${String(data.winner).padStart(2, "0")} WINS`,
                    `${data.elapsed.toFixed(2)} S`
                );
            }

            break;
    }
}


/* =========================
   TOURNAMENT — STATE
   ========================= */

const TOURNAMENT_KEY = "gold-sprint-tournament";

// Registered participants above this count ride a qualifying round first; the
// fastest 16 go on to the playoff bracket.
const QUALIFYING_TOP = 16;

// phase: "idle" (registration open) | "qualifying" | "playoff" | "done"
// participant: { id, name, time: number|null }   time = qualifying seconds
// match: { a, b, aTime, bTime, winner }          a/b/winner are participant ids
// heat: the race currently being run for the tournament, or null
let tournament = {
    phase: "idle",
    distance: 250,
    participants: [],
    seeds: [],
    bracket: null,
    heat: null
};

let nextParticipantId = 1;


// Prepared names for the debug fill button, so a tournament can be set up
// without typing every entrant.
const DEBUG_NAMES = [
    "ANNA", "BORIS", "VIKTOR", "GALINA", "DMITRI", "ELENA",
    "FEDOR", "IRINA", "KIRILL", "LARISA", "MAKSIM", "NINA",
    "OLEG", "POLINA", "ROMAN", "SVETA", "TIMUR", "ULYANA",
    "VADIM", "YANA", "ZAKHAR", "ARTEM", "DARYA", "EGOR"
];

const TOURNAMENT_DISTANCES = [10, 100, 250, 500, 666, 1000];


function saveTournament() {

    // heat is transient session state — never persist it, so a reload always
    // lands on a clean race screen even if a heat got stuck.
    const { heat, ...persisted } = tournament;

    try {
        localStorage.setItem(
            TOURNAMENT_KEY,
            JSON.stringify(persisted)
        );
    } catch (err) {
        console.warn("TOURNAMENT SAVE FAILED", err);
    }
}


function loadTournament() {

    try {
        const raw = localStorage.getItem(TOURNAMENT_KEY);

        if (raw) {
            tournament = Object.assign(tournament, JSON.parse(raw));
        }
    } catch (err) {
        console.warn("TOURNAMENT LOAD FAILED", err);
    }

    // A heat that was mid-race when the page reloaded can't be resumed.
    tournament.heat = null;

    nextParticipantId =
        tournament.participants.reduce(
            (max, p) => Math.max(max, p.id),
            0
        ) + 1;
}


function participantById(id) {
    return tournament.participants.find((p) => p.id === id) || null;
}


function participantName(id) {
    const p = participantById(id);

    return p ? p.name : "—";
}


function round2(value) {
    return value == null ? null : Math.round(value * 100) / 100;
}


function escapeHtml(value) {
    return String(value).replace(
        /[&<>"']/g,
        (c) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            "\"": "&quot;",
            "'": "&#39;"
        }[c])
    );
}


/* =========================
   TOURNAMENT — REGISTRATION
   ========================= */

function addParticipant(name) {

    const clean = name.trim().toUpperCase();

    if (!clean || tournament.phase !== "idle") {
        return;
    }

    tournament.participants.push({
        id: nextParticipantId++,
        name: clean,
        time: null
    });

    saveTournament();
    renderTournament();
}


function removeParticipant(id) {

    if (tournament.phase !== "idle") {
        return;
    }

    tournament.participants =
        tournament.participants.filter((p) => p.id !== id);

    saveTournament();
    renderTournament();
}


function debugFill(count) {

    if (tournament.phase !== "idle") {
        return;
    }

    nextParticipantId = 1;

    tournament.participants = DEBUG_NAMES.slice(0, count).map((name) => ({
        id: nextParticipantId++,
        name,
        time: null
    }));

    saveTournament();
    renderTournament();
}


function setTournamentDistance(metres) {

    if (!TOURNAMENT_DISTANCES.includes(metres)) {
        return;
    }

    tournament.distance = metres;

    saveTournament();
}


function resetTournament() {

    tournament = {
        phase: "idle",
        distance: tournament.distance || 250,
        participants: [],
        seeds: [],
        bracket: null,
        heat: null
    };

    nextParticipantId = 1;

    clearLaneLabels();

    saveTournament();
    renderTournament();
    updateSidebar();
}


function startTournament() {

    const count = tournament.participants.length;

    if (count < 2 || tournament.phase !== "idle") {
        return;
    }

    tournament.participants.forEach((p) => { p.time = null; });

    if (count > QUALIFYING_TOP) {

        tournament.phase = "qualifying";

    } else {

        tournament.phase = "playoff";
        buildPlayoff(tournament.participants.map((p) => p.id));
    }

    saveTournament();
    renderTournament();
    updateSidebar();
}


/* =========================
   TOURNAMENT — QUALIFYING
   ========================= */

function qualifyingRanking() {

    const raced = tournament.participants
        .filter((p) => p.time != null)
        .slice()
        .sort((a, b) => a.time - b.time);

    const pending = tournament.participants.filter((p) => p.time == null);

    return { raced, pending };
}


function finishQualifying() {

    const { raced, pending } = qualifyingRanking();

    if (pending.length > 0) {
        return;
    }

    buildPlayoff(raced.slice(0, QUALIFYING_TOP).map((p) => p.id));

    tournament.phase = "playoff";

    saveTournament();
    renderTournament();
    updateSidebar();
}


/* =========================
   TOURNAMENT — BRACKET
   ========================= */

// seedSlots returns the seed numbers in bracket-slot order for a bracket of the
// given (power-of-two) size, so seed 1 and seed 2 only meet in the final.
function seedSlots(size) {

    let slots = [1, 2];

    while (slots.length < size) {

        const sum = slots.length * 2 + 1;
        const next = [];

        for (const s of slots) {
            next.push(s);
            next.push(sum - s);
        }

        slots = next;
    }

    return slots;
}


function emptyMatch(a, b) {
    return {
        a: a == null ? null : a,
        b: b == null ? null : b,
        aTime: null,
        bTime: null,
        winner: null
    };
}


function buildPlayoff(seedIds) {

    tournament.seeds = seedIds.slice();

    const n = seedIds.length;

    let size = 2;
    while (size < n) {
        size *= 2;
    }

    const slotIds =
        seedSlots(size).map((seed) => (seed <= n ? seedIds[seed - 1] : null));

    const roundCount = Math.round(Math.log2(size));
    const rounds = [];

    const first = [];
    for (let m = 0; m < size / 2; m++) {
        first.push(emptyMatch(slotIds[2 * m], slotIds[2 * m + 1]));
    }
    rounds.push(first);

    for (let r = 1; r < roundCount; r++) {
        const round = [];
        for (let m = 0; m < rounds[r - 1].length / 2; m++) {
            round.push(emptyMatch(null, null));
        }
        rounds.push(round);
    }

    tournament.bracket = {
        size,
        rounds,
        third: roundCount >= 2 ? emptyMatch(null, null) : null
    };

    resolveByes();
}


function resolveByes() {

    tournament.bracket.rounds[0].forEach((match, m) => {

        const hasA = match.a != null;
        const hasB = match.b != null;

        if (hasA !== hasB) {
            match.winner = hasA ? match.a : match.b;
            advanceWinner(0, m, match.winner);
        }
    });

    normalizeThird();
    checkTournamentDone();
}


function advanceWinner(roundIndex, matchIndex, winnerId) {

    const rounds = tournament.bracket.rounds;
    const lastRound = rounds.length - 1;
    const semiIndex = lastRound - 1;

    if (roundIndex === lastRound) {
        checkTournamentDone();
        return;
    }

    const nextMatch = Math.floor(matchIndex / 2);
    const nextSide = matchIndex % 2 === 0 ? "a" : "b";

    rounds[roundIndex + 1][nextMatch][nextSide] = winnerId;

    if (roundIndex === semiIndex && tournament.bracket.third) {

        const match = rounds[roundIndex][matchIndex];
        const loserId = match.a === winnerId ? match.b : match.a;

        if (loserId != null) {
            tournament.bracket.third[matchIndex % 2 === 0 ? "a" : "b"] = loserId;
        }

        normalizeThird();
    }
}


// normalizeThird awards the 3rd-place match automatically when only one
// semi-finalist is available to contest it (happens when the other semi was a
// walkover).
function normalizeThird() {

    const bracket = tournament.bracket;

    if (!bracket.third || bracket.third.winner != null) {
        return;
    }

    const semis = bracket.rounds[bracket.rounds.length - 2];

    if (!semis.every((m) => m.winner != null)) {
        return;
    }

    const t = bracket.third;

    if (t.a != null && t.b == null) {
        t.winner = t.a;
    } else if (t.b != null && t.a == null) {
        t.winner = t.b;
    }
}


function roundLabel(roundIndex) {

    const fromEnd = tournament.bracket.rounds.length - 1 - roundIndex;

    return (
        fromEnd === 0 ? "ФИНАЛ" :
        fromEnd === 1 ? "ПОЛУФИНАЛ" :
        fromEnd === 2 ? "ЧЕТВЕРТЬФИНАЛ" :
        fromEnd === 3 ? "1/8 ФИНАЛА" :
        `РАУНД ${roundIndex + 1}`
    );
}


function matchIsPlayable(match) {
    return match.winner == null && match.a != null && match.b != null;
}


// nextPlayableMatch picks the match to run next in a fixed order — earliest
// round first, top to bottom, with the 3rd-place match slotted in after the
// semi-finals — so there is always a clear "who's up next".
function nextPlayableMatch() {

    const bracket = tournament.bracket;

    if (!bracket) {
        return null;
    }

    const rounds = bracket.rounds;

    for (let r = 0; r < rounds.length; r++) {

        for (let m = 0; m < rounds[r].length; m++) {
            if (matchIsPlayable(rounds[r][m])) {
                return {
                    roundIndex: r,
                    matchIndex: m,
                    isThird: false,
                    match: rounds[r][m]
                };
            }
        }

        if (r === rounds.length - 2
            && bracket.third
            && matchIsPlayable(bracket.third)) {

            return {
                roundIndex: r,
                matchIndex: 0,
                isThird: true,
                match: bracket.third
            };
        }
    }

    return null;
}


function checkTournamentDone() {

    const bracket = tournament.bracket;

    if (!bracket) {
        return;
    }

    const final = bracket.rounds[bracket.rounds.length - 1][0];
    const thirdDone = !bracket.third || bracket.third.winner != null;

    if (final.winner != null && thirdDone) {
        tournament.phase = "done";
    }
}


// eliminationLabel is the short "result" string shown next to a participant.
function eliminationLabel(id) {

    if (tournament.phase === "qualifying") {
        const p = participantById(id);
        return p && p.time != null ? `${p.time.toFixed(2)} S` : "—";
    }

    const bracket = tournament.bracket;

    if (!bracket) {
        return "";
    }

    const final = bracket.rounds[bracket.rounds.length - 1][0];

    if (final.winner === id) {
        return "ЧЕМПИОН";
    }

    if (final.a === id || final.b === id) {
        return final.winner != null ? "2-Е МЕСТО" : "ФИНАЛ";
    }

    if (bracket.third) {
        if (bracket.third.winner === id) {
            return "3-Е МЕСТО";
        }
        if (bracket.third.a === id || bracket.third.b === id) {
            return bracket.third.winner != null ? "4-Е МЕСТО" : "ЗА 3-Е МЕСТО";
        }
    }

    for (let r = bracket.rounds.length - 1; r >= 0; r--) {
        for (const match of bracket.rounds[r]) {
            if (match.a !== id && match.b !== id) {
                continue;
            }
            if (match.winner != null && match.winner !== id) {
                return `ВЫБЫЛ · ${roundLabel(r)}`;
            }
            if (match.winner == null) {
                return roundLabel(r);
            }
        }
    }

    return "—";
}


/* =========================
   TOURNAMENT — HEATS
   ========================= */

function setLaneLabels(name1, name2) {
    riderName1.textContent = name1;
    riderName2.textContent = name2;
}


function clearLaneLabels() {
    riderName1.textContent = "RIDER 01";
    riderName2.textContent = "RIDER 02";
    updateRaceHeatBanner();
}


// Wipe the race screen back to a fresh start — speeds, distances, cadence,
// progress bars and any lingering overlay — so НА ГОНКУ begins a clean heat.
function resetRaceScreen() {

    ["1", "2"].forEach((n) => {
        document.getElementById(`speed-${n}`).textContent = "0.0";
        document.getElementById(`cadence-${n}`).textContent = "0";
        document.getElementById(`distance-${n}`).textContent = "0.0";
        document.getElementById(`progress-${n}`).style.width = "0%";
    });

    hideOverlay();

    resultDismissed = true;

    startButton.disabled = false;
    distanceSelect.disabled = false;
}


function heatRoundName() {

    const heat = tournament.heat;

    if (!heat) {
        return "";
    }

    if (heat.mode === "qual") {
        return "ОТБОРОЧНЫЙ ЗАЕЗД";
    }

    if (heat.isThird) {
        return "ЗА 3-Е МЕСТО";
    }

    return roundLabel(heat.roundIndex);
}


// The banner above the race that names the current tournament heat and which
// rider is on which lane.
function updateRaceHeatBanner() {

    const heat = tournament.heat;

    if (!heat) {
        raceHeat.classList.add("hidden");
        raceHeat.innerHTML = "";
        return;
    }

    const n1 = heat.lane1 != null ? escapeHtml(participantName(heat.lane1)) : "—";
    const n2 = heat.lane2 != null ? escapeHtml(participantName(heat.lane2)) : "—";

    raceHeat.innerHTML = `
        <span class="race-heat-round">ТУРНИР · ${heatRoundName()} · ${heat.distance} M</span>
        <span class="race-heat-pair">
            <span class="lane-1">${n1}</span>
            <span class="race-heat-vs">/</span>
            <span class="lane-2">${n2}</span>
        </span>
        <button class="race-heat-exit" id="exit-heat-btn" type="button">
            выйти в свободную гонку
        </button>
    `;

    raceHeat.classList.remove("hidden");
}


// Escape hatch: drop out of the current tournament heat and put the race screen
// back into plain free-race mode. A fallback if a heat gets stuck.
function exitHeat() {

    tournament.heat = null;

    clearLaneLabels();
    resetRaceScreen();

    statusEl.textContent = "READY";

    saveTournament();
    updateSidebar();
}


raceHeat.addEventListener("click", (event) => {
    if (event.target.id === "exit-heat-btn") {
        exitHeat();
    }
});


function startHeat(mode, opts) {

    tournament.heat = Object.assign(
        {
            mode,
            // armed flips true on the next countdown, so a stale "finished" from
            // the previous race can't auto-complete this heat.
            armed: false,
            done: false,
            recorded: false,
            distance: tournament.distance
        },
        opts
    );

    setLaneLabels(
        opts.lane1 != null ? participantName(opts.lane1) : "—",
        opts.lane2 != null ? participantName(opts.lane2) : "—"
    );

    raceDistance = tournament.distance;
    updateRaceDistance();

    updateRaceHeatBanner();

    // НА ГОНКУ moves to the next iteration: clear the previous heat's numbers,
    // progress and overlay. raceScreenStaged() then keeps the previous race's
    // trailing messages from repainting until this heat's own countdown starts.
    resetRaceScreen();

    saveTournament();

    showScreen("race");

    statusEl.textContent = `${heatRoundName()} — НАЖМИТЕ START`;
}


function playQualHeat() {

    const v1 = document.getElementById("q-lane-1").value;
    const v2 = document.getElementById("q-lane-2").value;

    const lane1 = v1 ? Number(v1) : null;
    let lane2 = v2 ? Number(v2) : null;

    if (lane2 != null && lane2 === lane1) {
        lane2 = null;
    }

    if (lane1 == null && lane2 == null) {
        return;
    }

    startHeat("qual", { lane1, lane2 });
}


function playMatch(roundIndex, matchIndex, isThird) {

    const match = isThird
        ? tournament.bracket.third
        : tournament.bracket.rounds[roundIndex][matchIndex];

    if (!matchIsPlayable(match)) {
        return;
    }

    startHeat("play", {
        roundIndex,
        matchIndex,
        isThird,
        lane1: match.a,
        lane2: match.b
    });
}


function handleTournamentFinish(data) {

    const heat = tournament.heat;
    const times = data.times || {};

    if (heat.mode === "qual") {
        handleQualFinish(heat, times);
    } else {
        handlePlayFinish(heat, data, times);
    }
}


function handleQualFinish(heat, times) {

    const need = [];
    if (heat.lane1 != null) need.push(1);
    if (heat.lane2 != null) need.push(2);

    const haveAll = need.every((lane) => times[lane] != null);

    if (!haveAll) {

        const done = need
            .filter((lane) => times[lane] != null)
            .map((lane) => {
                const id = lane === 1 ? heat.lane1 : heat.lane2;
                return `${participantName(id)} ${times[lane].toFixed(2)}`;
            });

        statusEl.textContent =
            done.length ? `${done.join("   ")}   ...` : "FINISHING...";

        return;
    }

    if (!heat.recorded) {

        heat.recorded = true;

        if (heat.lane1 != null) {
            participantById(heat.lane1).time = round2(times[1]);
        }
        if (heat.lane2 != null) {
            participantById(heat.lane2).time = round2(times[2]);
        }

        heat.done = true;

        saveTournament();
        updateSidebar();
    }

    statusEl.textContent = "HEAT RECORDED";

    if (!resultDismissed) {

        const line1 = heat.lane1 != null
            ? `${participantName(heat.lane1)} — ${times[1].toFixed(2)} S`
            : "";

        const line2 = heat.lane2 != null
            ? `${participantName(heat.lane2)} — ${times[2].toFixed(2)} S`
            : "";

        const faster =
            heat.lane2 == null ? 1 :
            heat.lane1 == null ? 2 :
            times[1] <= times[2] ? 1 : 2;

        showResult(
            faster,
            "ЗАЕЗД ЗАПИСАН",
            line1 || line2,
            line1 && line2 ? line2 : ""
        );
    }
}


function handlePlayFinish(heat, data, times) {

    const winnerLane = data.winner;
    const winnerId = winnerLane === 1 ? heat.lane1 : heat.lane2;

    const match = heat.isThird
        ? tournament.bracket.third
        : tournament.bracket.rounds[heat.roundIndex][heat.matchIndex];

    // The loser crosses a moment after the winner, so keep taking times from
    // every "finished" message until both riders have one.
    if (times[1] != null) {
        match.aTime = round2(times[1]);
    } else if (winnerLane === 1 && match.aTime == null) {
        match.aTime = round2(data.elapsed);
    }

    if (times[2] != null) {
        match.bTime = round2(times[2]);
    } else if (winnerLane === 2 && match.bTime == null) {
        match.bTime = round2(data.elapsed);
    }

    if (!heat.recorded) {

        heat.recorded = true;
        heat.done = true;

        match.winner = winnerId;

        if (!heat.isThird) {
            advanceWinner(heat.roundIndex, heat.matchIndex, winnerId);
        }

        checkTournamentDone();
        updateSidebar();
    }

    saveTournament();

    statusEl.textContent = `>>> ${participantName(winnerId)} <<<`;

    if (!resultDismissed) {
        showResult(
            winnerLane,
            heat.isThird ? "3-Е МЕСТО" : "ПОБЕДИТЕЛЬ",
            participantName(winnerId),
            `${data.elapsed.toFixed(2)} S`
        );
    }
}


function endTournamentHeat() {

    tournament.heat = null;

    clearLaneLabels();

    saveTournament();
    renderTournament();
    updateSidebar();

    showScreen("tournament");
}


/* =========================
   TOURNAMENT — RENDERING
   ========================= */

function renderDistanceRow() {

    const options = TOURNAMENT_DISTANCES.map((d) =>
        `<option value="${d}" ${d === tournament.distance ? "selected" : ""}>${d} M</option>`
    ).join("");

    return `
        <div class="t-distance">
            <span class="t-distance-label">ДИСТАНЦИЯ ГОНКИ</span>
            <select id="tournament-distance">${options}</select>
        </div>
    `;
}


function renderDebugRow() {

    return `
        <div class="debug-row">
            <span class="debug-label">ДЕБАГ · ПОДСТАВИТЬ ИМЕНА</span>
            <div class="debug-buttons">
                <button class="debug-btn" data-act="debug" data-n="8">8</button>
                <button class="debug-btn" data-act="debug" data-n="16">16</button>
                <button class="debug-btn" data-act="debug" data-n="20">20</button>
            </div>
        </div>
    `;
}


function renderTournament() {

    if (!tournamentBody) {
        return;
    }

    try {

        if (tournament.phase === "qualifying") {
            tournamentBody.innerHTML = renderQualifying();
        } else if (tournament.phase === "playoff" || tournament.phase === "done") {
            tournamentBody.innerHTML = renderBracket(tournament.phase === "done");
        } else {
            tournamentBody.innerHTML = renderRegistration();
        }

    } catch (err) {

        console.error("TOURNAMENT RENDER FAILED", err);

        tournamentBody.innerHTML = `
            <div class="tournament-content">
                <div class="section-title">ОШИБКА ТУРНИРА</div>
                <div class="reg-hint">
                    Состояние турнира повреждено. Сбросьте его и начните заново —
                    свободная гонка на вкладке RACE работает как обычно.
                </div>
                <button class="main-button" data-act="reset">СБРОСИТЬ ТУРНИР</button>
            </div>
        `;
    }

    const input = document.getElementById("tournament-name-input");
    if (input) {
        input.focus();
    }
}


function renderRegistration() {

    const list = tournament.participants;

    const rows = list.map((p, i) => `
        <div class="reg-row">
            <span class="reg-index">${String(i + 1).padStart(2, "0")}</span>
            <span class="reg-name">${escapeHtml(p.name)}</span>
            <button class="reg-remove" data-act="remove" data-id="${p.id}" aria-label="Убрать">×</button>
        </div>
    `).join("");

    const count = list.length;

    const hint =
        count < 2 ? "Нужно минимум 2 участника" :
        count > QUALIFYING_TOP
            ? `Отборочный тур на время, затем плей-офф на 16`
            : `Плей-офф на ${count} — сразу сетка`;

    return `
        <div class="tournament-content">

            <div class="section-title">УЧАСТНИКИ — ${count}</div>

            <div class="reg-input-row">
                <input id="tournament-name-input" type="text"
                    placeholder="Имя участника" autocomplete="off" maxlength="24">
                <button class="reg-add" data-act="add">+</button>
            </div>

            <div class="reg-list">
                ${rows || `<div class="reg-empty">Список пуст</div>`}
            </div>

            ${renderDistanceRow()}

            <div class="reg-hint">${hint}</div>

            <button class="main-button" data-act="start" ${count < 2 ? "disabled" : ""}>
                НАЧАТЬ ТУРНИР
            </button>

            ${renderDebugRow()}

        </div>
    `;
}


function renderQualifying() {

    const { raced, pending } = qualifyingRanking();

    const total = tournament.participants.length;

    const racedRows = raced.map((p, i) => `
        <div class="q-row ${i < QUALIFYING_TOP ? "q-in" : "q-out"}">
            <span class="q-rank">${String(i + 1).padStart(2, "0")}</span>
            <span class="q-name">${escapeHtml(p.name)}</span>
            <span class="q-time">${p.time.toFixed(2)} S</span>
        </div>
    `).join("");

    const pendingRows = pending.map((p) => `
        <div class="q-row q-pending">
            <span class="q-rank">–</span>
            <span class="q-name">${escapeHtml(p.name)}</span>
            <span class="q-time">—</span>
        </div>
    `).join("");

    const options = (selected) => tournament.participants.map((p) => `
        <option value="${p.id}" ${p.id === selected ? "selected" : ""}>
            ${escapeHtml(p.name)}${p.time != null ? ` · ${p.time.toFixed(2)}` : ""}
        </option>
    `).join("");

    const d1 = (pending[0] || tournament.participants[0] || {}).id ?? "";
    const d2 = (pending[1] || {}).id ?? "";

    return `
        <div class="tournament-content">

            <div class="section-title">ОТБОРОЧНЫЙ ТУР — ${raced.length}/${total}</div>
            <div class="reg-hint">Каждый едет на время. В плей-офф выходят 16 лучших.</div>

            ${renderDistanceRow()}

            <div class="q-heat">

                <label class="q-lane">
                    <span class="q-lane-label lane-1">ДОРОЖКА 1</span>
                    <select id="q-lane-1">${options(d1)}</select>
                </label>

                <label class="q-lane">
                    <span class="q-lane-label lane-2">ДОРОЖКА 2</span>
                    <select id="q-lane-2">
                        <option value="">— никто —</option>
                        ${options(d2)}
                    </select>
                </label>

                <button class="main-button" data-act="qual-heat">НА ГОНКУ</button>

            </div>

            <div class="q-table">
                ${racedRows}
                ${pendingRows}
            </div>

            <button class="main-button" data-act="finish-qual" ${pending.length ? "disabled" : ""}>
                СОБРАТЬ ПЛЕЙ-ОФФ · ТОП 16
            </button>

            <button class="link-button" data-act="reset">Сбросить турнир</button>

        </div>
    `;
}


function renderBracket(isDone) {

    const bracket = tournament.bracket;
    const rounds = bracket.rounds;

    const next = isDone ? null : nextPlayableMatch();

    const isNextCard = (r, m, third) =>
        next != null
        && next.isThird === third
        && (third || (next.roundIndex === r && next.matchIndex === m));

    const columns = rounds.map((round, r) => `
        <div class="br-col">
            <div class="br-round-label">${roundLabel(r)}</div>
            ${round.map((match, m) =>
                renderMatchCard(match, r, m, false, isNextCard(r, m, false))
            ).join("")}
        </div>
    `).join("");

    const thirdColumn = bracket.third ? `
        <div class="br-col">
            <div class="br-round-label">ЗА 3-Е МЕСТО</div>
            ${renderMatchCard(bracket.third, rounds.length - 2, 0, true, isNextCard(0, 0, true))}
        </div>
    ` : "";

    let banner = "";

    if (isDone) {

        const final = rounds[rounds.length - 1][0];
        const champ = final.winner;
        const runner = final.a === champ ? final.b : final.a;
        const third =
            bracket.third && bracket.third.winner != null
                ? bracket.third.winner
                : null;

        banner = `
            <div class="br-champion">
                <div class="section-title">ИТОГИ</div>
                <div class="champ champ-1">1 · ${escapeHtml(participantName(champ))}</div>
                <div class="champ champ-2">2 · ${escapeHtml(participantName(runner))}</div>
                ${third != null ? `<div class="champ champ-3">3 · ${escapeHtml(participantName(third))}</div>` : ""}
                <button class="main-button" data-act="reset">НОВЫЙ ТУРНИР</button>
            </div>
        `;

    } else if (next) {

        banner = `
            <div class="br-next">
                <div class="br-next-eyebrow">
                    СЛЕДУЮЩИЙ ЗАЕЗД · ${next.isThird ? "ЗА 3-Е МЕСТО" : roundLabel(next.roundIndex)} · ${tournament.distance} M
                </div>
                <div class="br-next-pair">
                    <span class="lane-1">${escapeHtml(participantName(next.match.a))}</span>
                    <span class="br-next-vs">/</span>
                    <span class="lane-2">${escapeHtml(participantName(next.match.b))}</span>
                </div>
                <button class="main-button" data-act="play"
                    data-round="${next.roundIndex}" data-match="${next.matchIndex}"
                    data-third="${next.isThird ? "1" : "0"}">НА ГОНКУ</button>
            </div>
        `;

    } else {

        banner = `<div class="br-next br-next-wait">Ждём результатов текущего раунда</div>`;
    }

    return `
        <div class="tournament-content">
            ${banner}
            ${isDone ? "" : renderDistanceRow()}
            <div class="bracket-scroll">
                <div class="bracket">
                    ${columns}
                    ${thirdColumn}
                </div>
            </div>
            ${isDone ? "" : `<button class="link-button" data-act="reset">Сбросить турнир</button>`}
        </div>
    `;
}


function renderMatchCard(match, roundIndex, matchIndex, isThird, isNext) {

    const playable = matchIsPlayable(match);

    // An empty slot is a walkover only in the first round; later on it just
    // means the feeding match hasn't been raced yet.
    const emptyLabel = roundIndex === 0 && !isThird ? "БАЙ" : "—";

    const renderSide = (id, otherId, time) => {

        const label =
            id != null ? escapeHtml(participantName(id)) :
            otherId != null ? emptyLabel :
            "—";

        const cls =
            match.winner != null && match.winner === id ? "br-win" :
            match.winner != null && id != null ? "br-lose" :
            "";

        return `
            <div class="br-side ${cls}">
                <span class="br-pname">${label}</span>
                <span class="br-ptime">${time != null ? time.toFixed(2) : ""}</span>
            </div>
        `;
    };

    return `
        <div class="br-match ${playable ? "br-playable" : ""} ${isNext ? "br-match-next" : ""}">
            ${renderSide(match.a, match.b, match.aTime)}
            ${renderSide(match.b, match.a, match.bTime)}
            ${playable
                ? `<button class="br-play" data-act="play"
                       data-round="${roundIndex}" data-match="${matchIndex}"
                       data-third="${isThird ? "1" : "0"}">${isNext ? "▶ ГОНКА" : "ГОНКА"}</button>`
                : ""}
        </div>
    `;
}


function updateSidebar() {

    if (!tournamentSidebar) {
        return;
    }

    const show =
        tournament.phase !== "idle" && currentScreen === "race";

    tournamentSidebar.classList.toggle("hidden", !show);

    if (!show) {
        return;
    }

    let rows = "";

    if (tournament.phase === "qualifying") {

        const { raced, pending } = qualifyingRanking();

        rows += raced.map((p, i) => `
            <div class="sb-row ${i < QUALIFYING_TOP ? "" : "sb-dim"}">
                <span class="sb-name">${String(i + 1).padStart(2, "0")} ${escapeHtml(p.name)}</span>
                <span class="sb-val">${p.time.toFixed(2)}</span>
            </div>
        `).join("");

        rows += pending.map((p) => `
            <div class="sb-row sb-dim">
                <span class="sb-name">·· ${escapeHtml(p.name)}</span>
                <span class="sb-val">—</span>
            </div>
        `).join("");

    } else {

        const ids = tournament.seeds.length
            ? tournament.seeds
            : tournament.participants.map((p) => p.id);

        rows += ids.map((id) => {
            const label = eliminationLabel(id);
            const dim = label.startsWith("ВЫБЫЛ") || label === "4-Е МЕСТО" || label === "2-Е МЕСТО";
            return `
                <div class="sb-row ${dim ? "sb-dim" : ""}">
                    <span class="sb-name">${escapeHtml(participantName(id))}</span>
                    <span class="sb-val">${label}</span>
                </div>
            `;
        }).join("");
    }

    const heading =
        tournament.phase === "qualifying" ? "ОТБОР" :
        tournament.phase === "done" ? "ЗАВЕРШЁН" :
        "ПЛЕЙ-ОФФ";

    tournamentSidebar.innerHTML = `
        <div class="sb-title">ТУРНИР · ${heading}</div>
        <div class="sb-list">${rows}</div>
    `;
}


/* =========================
   TOURNAMENT — EVENTS
   ========================= */

tournamentBody.addEventListener("click", (event) => {

    const el = event.target.closest("[data-act]");

    if (!el) {
        return;
    }

    const act = el.dataset.act;

    if (act === "add") {

        const input = document.getElementById("tournament-name-input");
        if (input) {
            addParticipant(input.value);
        }

    } else if (act === "remove") {

        removeParticipant(Number(el.dataset.id));

    } else if (act === "start") {

        startTournament();

    } else if (act === "reset") {

        resetTournament();

    } else if (act === "qual-heat") {

        playQualHeat();

    } else if (act === "finish-qual") {

        finishQualifying();

    } else if (act === "play") {

        playMatch(
            Number(el.dataset.round),
            Number(el.dataset.match),
            el.dataset.third === "1"
        );

    } else if (act === "debug") {

        debugFill(Number(el.dataset.n));
    }
});


tournamentBody.addEventListener("change", (event) => {

    if (event.target.id === "tournament-distance") {
        setTournamentDistance(Number(event.target.value));
        renderTournament();
    }
});


tournamentBody.addEventListener("keydown", (event) => {

    if (event.key === "Enter" && event.target.id === "tournament-name-input") {
        event.preventDefault();
        addParticipant(event.target.value);
    }
});


/* =========================
   INITIALIZATION
   ========================= */

loadTournament();
renderTournament();

updateRaceDistance();

showScreen("race");
/* =========================================================================
   BLUETOOTH SENSORS

   Connects real speed/cadence sensors over Web Bluetooth and streams the
   readings to the Go server, which feeds them into the race in place of the
   simulation.

   Works with any sensor that speaks a Bluetooth SIG standard profile —
   CYCPLUS, Magene, iGPSPORT, XOSS, Wahoo, Garmin, Bryton and the like — via
   either the Cycling Speed and Cadence service (0x1816) or, as a fallback,
   the wheel/crank fields of the Cycling Power service (0x1818).

   Web Bluetooth needs Chrome / Edge (not Firefox or Safari) and a secure
   context — http://localhost counts, a LAN IP does not.

   app.js exposes window.raceApp:
     sendSensor(rider, speedKmh, cadenceRpm, wheelRevs)
     wheelCircumferenceMM(rider)
     setBleSource(rider, active)
   ========================================================================= */

const CSC_SERVICE = "00001816-0000-1000-8000-00805f9b34fb"; // 0x1816
const CSC_MEASUREMENT = "00002a5b-0000-1000-8000-00805f9b34fb"; // 0x2A5B

const CP_SERVICE = "00001818-0000-1000-8000-00805f9b34fb"; // 0x1818
const CP_MEASUREMENT = "00002a63-0000-1000-8000-00805f9b34fb"; // 0x2A63

// Names to offer in the chooser for sensors that don't advertise their service
// UUID. The service filters below catch everything else.
const SENSOR_NAME_PREFIXES = [
    "CYCPLUS", "CYC", "Magene", "MAGENE", "Mover", "iGPSPORT", "IGPSPORT",
    "IGS", "SPD", "CAD", "XOSS", "CooSpo", "COOSPO", "Wahoo", "Garmin",
    "Bryton", "BSC", "ELITE", "SPEED", "CADENCE"
];

// How long a wheel / crank can be silent before we call the reading zero.
const WHEEL_IDLE_MS = 1500;
const CRANK_IDLE_MS = 2500;


function newSensorState() {
    return {
        device: null,
        characteristic: null,
        connected: false,
        emulating: false,
        emuTimer: null,

        profile: "csc", // "csc" | "cp"

        // previous reading, for deltas
        prevWheelRevs: null,
        prevWheelTime: null, // uint16 event-time ticks
        prevCrankRevs: null,
        prevCrankTime: null,

        rawWheelRevs: 0, // cumulative counter straight from the sensor
        speed: 0, // km/h
        cadence: 0, // rpm

        lastWheelMove: 0, // performance.now() when wheel revs last increased
        lastCrankMove: 0,

        hasWheel: false,
        hasCrank: false
    };
}

const sensors = { 1: newSensorState(), 2: newSensorState() };


/* ---- connect / disconnect ------------------------------------------------ */

async function connectSensor(rider, acceptAll) {

    if (!navigator.bluetooth) {
        setStatus(rider, "Web Bluetooth недоступен — откройте в Chrome или Edge", true);
        return;
    }

    setStatus(rider, "выбор устройства...");

    let device;

    const optionalServices = [CSC_SERVICE, CP_SERVICE];

    try {
        device = await navigator.bluetooth.requestDevice(
            acceptAll
                ? { acceptAllDevices: true, optionalServices }
                : {
                    filters: [
                        { services: [CSC_SERVICE] },
                        { services: [CP_SERVICE] },
                        ...SENSOR_NAME_PREFIXES.map((namePrefix) => ({ namePrefix }))
                    ],
                    optionalServices
                }
        );
    } catch (err) {
        setStatus(
            rider,
            err.name === "NotFoundError" ? "устройство не выбрано" : `ошибка: ${err.message}`,
            err.name !== "NotFoundError"
        );
        return;
    }

    const st = sensors[rider];
    st.device = device;

    device.addEventListener("gattserverdisconnected", () => onDisconnected(rider));

    try {
        await attach(rider);
    } catch (err) {
        console.error("BLE connect failed", err);
        setStatus(rider, `ошибка подключения: ${err.message}`, true);
    }
}


async function attach(rider) {

    const st = sensors[rider];

    setStatus(rider, `подключение к ${st.device.name || "датчику"}...`);

    const server = await st.device.gatt.connect();

    // Prefer the Cycling Speed and Cadence service; fall back to the wheel/crank
    // fields of the Cycling Power service for sensors that only expose that.
    let ch;

    try {
        const svc = await server.getPrimaryService(CSC_SERVICE);
        ch = await svc.getCharacteristic(CSC_MEASUREMENT);
        st.profile = "csc";
    } catch (cscErr) {
        const svc = await server.getPrimaryService(CP_SERVICE);
        ch = await svc.getCharacteristic(CP_MEASUREMENT);
        st.profile = "cp";
    }

    st.characteristic = ch;
    ch.addEventListener("characteristicvaluechanged", (e) =>
        onMeasurement(rider, e.target.value)
    );

    await ch.startNotifications();

    resetDeltas(st);
    st.connected = true;

    window.raceApp.setBleSource(rider, true);
    setStatus(
        rider,
        `подключён: ${st.device.name || "датчик"} · ${st.profile.toUpperCase()}`
    );
    updateTag(rider);
}


function disconnectSensor(rider) {

    const st = sensors[rider];

    if (st.emulating) {
        stopEmulation(rider);
        return;
    }

    if (st.device && st.device.gatt.connected) {
        st.device.gatt.disconnect();
    }

    st.device = null;
    st.connected = false;
    st.speed = 0;
    st.cadence = 0;

    window.raceApp.setBleSource(rider, false);
    setStatus(rider, "не подключён");
    updateTag(rider);
}


function onDisconnected(rider) {

    const st = sensors[rider];

    st.connected = false;
    st.characteristic = null;
    st.speed = 0;
    st.cadence = 0;

    window.raceApp.setBleSource(rider, false);
    updateTag(rider);

    if (st.device) {
        setStatus(rider, "связь потеряна — переподключение...", true);
        reconnect(rider, 4);
    }
}


async function reconnect(rider, tries) {

    const st = sensors[rider];

    if (!st.device || st.connected || tries <= 0) {
        if (!st.connected && st.device) {
            setStatus(rider, "не удалось переподключиться — нажмите «Подключить»", true);
        }
        return;
    }

    try {
        await attach(rider);
    } catch (err) {
        setTimeout(() => reconnect(rider, tries - 1), 2000);
    }
}


function resetDeltas(st) {
    st.prevWheelRevs = null;
    st.prevWheelTime = null;
    st.prevCrankRevs = null;
    st.prevCrankTime = null;
}


/* ---- measurement parsing --------------------------------------------------

   CSC Measurement (0x2A5B):
     flags(uint8)
     bit0: cumWheelRevs(uint32) lastWheelEventTime(uint16, 1/1024 s)
     bit1: cumCrankRevs(uint16) lastCrankEventTime(uint16, 1/1024 s)

   Cycling Power Measurement (0x2A63):
     flags(uint16) instPower(sint16)
     bit0: pedalPowerBalance(uint8)
     bit2: accumulatedTorque(uint16)
     bit4: cumWheelRevs(uint32) lastWheelEventTime(uint16, 1/2048 s)
     bit5: cumCrankRevs(uint16) lastCrankEventTime(uint16, 1/1024 s)

   Both event-time fields are uint16 and wrap at 65536.
------------------------------------------------------------------------- */

function parseCSC(view) {
    const flags = view.getUint8(0);
    let off = 1;

    const r = { wheelHz: 1024, crankHz: 1024 };

    if (flags & 0x01) {
        r.wheelRevs = view.getUint32(off, true); off += 4;
        r.wheelTicks = view.getUint16(off, true); off += 2;
    }
    if (flags & 0x02) {
        r.crankRevs = view.getUint16(off, true); off += 2;
        r.crankTicks = view.getUint16(off, true); off += 2;
    }
    return r;
}

function parseCP(view) {
    const flags = view.getUint16(0, true);
    let off = 2 + 2; // flags + instantaneous power

    if (flags & 0x0001) off += 1; // pedal power balance
    if (flags & 0x0004) off += 2; // accumulated torque

    const r = { wheelHz: 2048, crankHz: 1024 };

    if (flags & 0x0010) {
        r.wheelRevs = view.getUint32(off, true); off += 4;
        r.wheelTicks = view.getUint16(off, true); off += 2;
    }
    if (flags & 0x0020) {
        r.crankRevs = view.getUint16(off, true); off += 2;
        r.crankTicks = view.getUint16(off, true); off += 2;
    }
    return r;
}

function onMeasurement(rider, view) {
    const r = sensors[rider].profile === "cp" ? parseCP(view) : parseCSC(view);
    applyReading(rider, r);
}

// applyReading turns a parsed { wheelRevs, wheelTicks, wheelHz, crankRevs,
// crankTicks, crankHz } into speed and cadence, whatever profile it came from.
function applyReading(rider, r) {

    const st = sensors[rider];
    const now = performance.now();

    if (r.wheelRevs != null) {

        st.hasWheel = true;
        st.rawWheelRevs = r.wheelRevs;

        if (st.prevWheelRevs != null) {
            // The wheel counter is a 32-bit cumulative total — in practice it
            // never wraps, so a negative delta means the sensor reset. Skip it.
            const dRevs = r.wheelRevs - st.prevWheelRevs;
            const dTicks = (r.wheelTicks - st.prevWheelTime + 65536) % 65536;

            if (dRevs >= 0 && dTicks > 0 && dRevs > 0) {
                const dt = dTicks / r.wheelHz;
                const circ = window.raceApp.wheelCircumferenceMM(rider) / 1000; // m
                st.speed = (dRevs * circ / dt) * 3.6; // km/h
                st.lastWheelMove = now;
            }
        } else {
            st.lastWheelMove = now;
        }

        st.prevWheelRevs = r.wheelRevs;
        st.prevWheelTime = r.wheelTicks;
    }

    if (r.crankRevs != null) {

        st.hasCrank = true;

        if (st.prevCrankRevs != null) {
            const dRevs = (r.crankRevs - st.prevCrankRevs + 65536) % 65536;
            const dTicks = (r.crankTicks - st.prevCrankTime + 65536) % 65536;

            if (dTicks > 0 && dRevs > 0) {
                st.cadence = (dRevs * 60) / (dTicks / r.crankHz); // rpm
                st.lastCrankMove = now;
            }
        } else {
            st.lastCrankMove = now;
        }

        st.prevCrankRevs = r.crankRevs;
        st.prevCrankTime = r.crankTicks;
    }

    push(rider);
}


// A stopped wheel / crank simply stops producing events, so decay to zero.
function decayIdle(st) {
    const now = performance.now();

    if (st.hasWheel && now - st.lastWheelMove > WHEEL_IDLE_MS) {
        st.speed = 0;
    }
    if (st.hasCrank && now - st.lastCrankMove > CRANK_IDLE_MS) {
        st.cadence = 0;
    }
}


function push(rider) {
    const st = sensors[rider];
    decayIdle(st);
    window.raceApp.sendSensor(rider, st.speed, st.cadence, st.rawWheelRevs);

    const live = document.getElementById(`ble-live-${rider}`);
    if (live && (st.connected || st.emulating)) {
        live.textContent = `${st.speed.toFixed(1)} км/ч`;
    }
}


// Keep pushing while connected so the server sees a fresh "0" when the wheel
// stops instead of the last non-zero value.
setInterval(() => {
    [1, 2].forEach((rider) => {
        const st = sensors[rider];
        if (st.connected && !st.emulating) {
            push(rider);
        }
    });
}, 500);


/* ---- emulation (test the whole pipeline without hardware) --------------- */

function toggleEmulation(rider) {
    if (sensors[rider].emulating) {
        stopEmulation(rider);
    } else {
        startEmulation(rider);
    }
}

function startEmulation(rider) {

    const st = sensors[rider];

    if (st.connected) {
        return;
    }

    if (st.emuTimer) {
        clearInterval(st.emuTimer);
        st.emuTimer = null;
    }

    resetDeltas(st);
    st.emulating = true;
    st.connected = false;
    st.profile = "csc";
    st.hasWheel = true;
    st.hasCrank = true;

    window.raceApp.setBleSource(rider, true);
    setStatus(rider, "ЭМУЛЯЦИЯ — тест без датчика");
    updateTag(rider);

    const wheelTargetRps = 4.5 + Math.random() * 3.5; // ~34-61 km/h at 2.1 m
    const crankTargetRps = 1.3 + Math.random() * 0.4; // ~80-100 rpm

    const wheelRevs0 = 1000 + Math.floor(Math.random() * 500);
    const crankRevs0 = 500;

    // Rides like a real trainer: spins up quickly, coasts down slowly. The rider
    // warms up (READY), lets the wheel coast during the countdown, and goes on
    // GO. Set st.emuJumpTheGun to add power mid-countdown and trip the
    // false-start detection.
    let wheelRps = 0;
    let crankRps = 0;
    let wheelAccum = wheelRevs0;
    let crankAccum = crankRevs0;
    let wheelInt = wheelRevs0;
    let crankInt = crankRevs0;
    let wheelEventTicks = 0;
    let crankEventTicks = 0;
    let simTicks = 0; // 1/1024 s
    let countdownSec = 0;
    let lastMs = performance.now();

    const approach = (cur, target, upRate, downRate, dt) => {
        const rate = target > cur ? upRate : downRate;
        const step = rate * dt;
        return Math.abs(target - cur) <= step
            ? target
            : cur + Math.sign(target - cur) * step;
    };

    st.emuTimer = setInterval(() => {
        const nowMs = performance.now();
        const dt = Math.min((nowMs - lastMs) / 1000, 2);
        lastMs = nowMs;

        const appState = window.raceApp.state;
        const inCountdown = appState === "countdown";
        countdownSec = inCountdown ? countdownSec + dt : 0;

        let spin = appState === "ready" || appState === "running";
        if (inCountdown && st.emuJumpTheGun && countdownSec > 0.9) {
            spin = true; // the "jump": add power partway through the countdown
        }

        const wheelTarget = spin ? wheelTargetRps : 0;
        const crankTarget = spin ? crankTargetRps : 0;

        // rev/s^2: quick to spin up, slow to coast down
        wheelRps = approach(wheelRps, wheelTarget, 6, 1.3, dt);
        crankRps = approach(crankRps, crankTarget, 4, 1.0, dt);

        wheelAccum += wheelRps * dt;
        crankAccum += crankRps * dt;
        simTicks = (simTicks + Math.round(dt * 1024)) % 65536;

        // The event time only advances while the wheel / crank is actually
        // turning; once stopped it holds, which the parser reads as zero speed.
        if (Math.floor(wheelAccum) > wheelInt) {
            wheelInt = Math.floor(wheelAccum);
            wheelEventTicks = simTicks;
        }
        if (Math.floor(crankAccum) > crankInt) {
            crankInt = Math.floor(crankAccum);
            crankEventTicks = simTicks;
        }

        const dv = new DataView(new ArrayBuffer(11));
        dv.setUint8(0, 0x03);
        dv.setUint32(1, wheelInt, true);
        dv.setUint16(5, wheelEventTicks, true);
        dv.setUint16(7, crankInt % 65536, true);
        dv.setUint16(9, crankEventTicks, true);

        onMeasurement(rider, dv);
    }, 400);
}

function stopEmulation(rider) {

    const st = sensors[rider];

    clearInterval(st.emuTimer);
    st.emuTimer = null;
    st.emulating = false;
    st.speed = 0;
    st.cadence = 0;
    resetDeltas(st);

    window.raceApp.setBleSource(rider, false);
    setStatus(rider, "не подключён");
    updateTag(rider);
}


/* ---- UI --------------------------------------------------------------------- */

function setStatus(rider, text, isError) {
    const el = document.getElementById(`ble-status-${rider}`);
    if (!el) {
        return;
    }
    el.textContent = text;
    el.classList.toggle("ble-error", Boolean(isError));
}

function updateTag(rider) {
    const el = document.getElementById(`sensor-tag-${rider}`);
    if (!el) {
        return;
    }

    const st = sensors[rider];

    if (st.connected || st.emulating) {
        el.textContent = st.emulating ? "◎ ЭМУЛЯЦИЯ" : "◉ ДАТЧИК";
        el.hidden = false;
    } else {
        el.hidden = true;
    }
}


[1, 2].forEach((rider) => {
    const connect = document.getElementById(`ble-connect-${rider}`);
    const all = document.getElementById(`ble-connect-all-${rider}`);
    const disconnect = document.getElementById(`ble-disconnect-${rider}`);
    const emulate = document.getElementById(`ble-emulate-${rider}`);

    if (connect) connect.addEventListener("click", () => connectSensor(rider, false));
    if (all) all.addEventListener("click", () => connectSensor(rider, true));
    if (disconnect) disconnect.addEventListener("click", () => disconnectSensor(rider));
    if (emulate) emulate.addEventListener("click", () => toggleEmulation(rider));
});

if (!navigator.bluetooth) {
    [1, 2].forEach((rider) =>
        setStatus(rider, "Web Bluetooth недоступен — Chrome или Edge, по HTTPS/localhost", true)
    );
}

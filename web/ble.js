/* =========================================================================
   BLUETOOTH SENSORS

   Connects real CYCPLUS-style speed/cadence sensors over Web Bluetooth using
   the standard Cycling Speed and Cadence (CSC) GATT service, does the
   speed/cadence maths in the browser, and streams the readings to the Go
   server, which feeds them into the race in place of the simulation.

   Web Bluetooth needs Chrome / Edge (not Firefox or Safari) and a secure
   context — http://localhost counts, a LAN IP does not.

   app.js exposes window.raceApp:
     sendSensor(rider, speedKmh, cadenceRpm, wheelRevs)
     wheelCircumferenceMM(rider)
     setBleSource(rider, active)
   ========================================================================= */

const CSC_SERVICE = "00001816-0000-1000-8000-00805f9b34fb"; // 0x1816
const CSC_MEASUREMENT = "00002a5b-0000-1000-8000-00805f9b34fb"; // 0x2A5B

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

        // previous CSC reading, for deltas
        prevWheelRevs: null,
        prevWheelTime: null, // uint16, units of 1/1024 s
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

    try {
        device = await navigator.bluetooth.requestDevice(
            acceptAll
                ? { acceptAllDevices: true, optionalServices: [CSC_SERVICE] }
                : {
                    filters: [
                        { services: [CSC_SERVICE] },
                        { namePrefix: "CYCPLUS" },
                        { namePrefix: "CYC" }
                    ],
                    optionalServices: [CSC_SERVICE]
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
    const service = await server.getPrimaryService(CSC_SERVICE);
    const ch = await service.getCharacteristic(CSC_MEASUREMENT);

    st.characteristic = ch;
    ch.addEventListener("characteristicvaluechanged", (e) =>
        onMeasurement(rider, e.target.value)
    );

    await ch.startNotifications();

    resetDeltas(st);
    st.connected = true;

    window.raceApp.setBleSource(rider, true);
    setStatus(rider, `подключён: ${st.device.name || "датчик"}`);
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


/* ---- CSC measurement parsing ------------------------------------------------

   Layout: flags(uint8)
           if flags bit0: cumulativeWheelRevolutions(uint32) lastWheelEventTime(uint16)
           if flags bit1: cumulativeCrankRevolutions(uint16) lastCrankEventTime(uint16)
   Event times are in 1/1024 s and wrap at 65536.
--------------------------------------------------------------------------- */

function onMeasurement(rider, view) {

    const st = sensors[rider];
    const flags = view.getUint8(0);
    const now = performance.now();

    let offset = 1;

    if (flags & 0x01) {
        const wheelRevs = view.getUint32(offset, true);
        offset += 4;
        const wheelTime = view.getUint16(offset, true);
        offset += 2;

        st.hasWheel = true;
        st.rawWheelRevs = wheelRevs;

        if (st.prevWheelRevs != null) {
            const dRevs = (wheelRevs - st.prevWheelRevs) >>> 0;
            const dTicks = (wheelTime - st.prevWheelTime + 65536) % 65536;

            // A changed event time means at least one new wheel revolution.
            if (dTicks > 0 && dRevs > 0) {
                const dt = dTicks / 1024;
                const circ = window.raceApp.wheelCircumferenceMM(rider) / 1000; // m
                st.speed = (dRevs * circ / dt) * 3.6; // km/h
                st.lastWheelMove = now;
            }
        } else {
            st.lastWheelMove = now;
        }

        st.prevWheelRevs = wheelRevs;
        st.prevWheelTime = wheelTime;
    }

    if (flags & 0x02) {
        const crankRevs = view.getUint16(offset, true);
        offset += 2;
        const crankTime = view.getUint16(offset, true);
        offset += 2;

        st.hasCrank = true;

        if (st.prevCrankRevs != null) {
            const dRevs = (crankRevs - st.prevCrankRevs + 65536) % 65536;
            const dTicks = (crankTime - st.prevCrankTime + 65536) % 65536;

            if (dTicks > 0 && dRevs > 0) {
                st.cadence = (dRevs * 60) / (dTicks / 1024); // rpm
                st.lastCrankMove = now;
            }
        } else {
            st.lastCrankMove = now;
        }

        st.prevCrankRevs = crankRevs;
        st.prevCrankTime = crankTime;
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
        live.textContent =
            `${st.speed.toFixed(1)} км/ч · ${Math.round(st.cadence)} об/мин`;
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

    resetDeltas(st);
    st.emulating = true;
    st.connected = false;
    st.hasWheel = true;
    st.hasCrank = true;

    window.raceApp.setBleSource(rider, true);
    setStatus(rider, "ЭМУЛЯЦИЯ — тест без датчика");
    updateTag(rider);

    const wheelRevPerSec = 3.7 + Math.random() * 1.6; // ~28-42 km/h at 2.1 m
    const crankRevPerSec = 1.3 + Math.random() * 0.4; // ~80-100 rpm

    const wheelRevs0 = 1000 + Math.floor(Math.random() * 500);
    const crankRevs0 = 500;

    let wheelInt = wheelRevs0;
    let crankInt = crankRevs0;
    let wheelEventTicks = 0;
    let crankEventTicks = 0;

    // spinSec is time the emulated wheel has actually been turning. The rider
    // spins to check the sensor (READY), holds still at the line (countdown),
    // and goes on GO (running). Set st.emuJumpTheGun to keep spinning through
    // the countdown and test the false-start detection.
    let spinSec = 0;
    let lastMs = performance.now();

    st.emuTimer = setInterval(() => {
        const nowMs = performance.now();
        const wall = (nowMs - lastMs) / 1000;
        lastMs = nowMs;

        const spinning =
            st.emuJumpTheGun ||
            window.raceApp.state === "ready" ||
            window.raceApp.state === "running";

        if (spinning) {
            spinSec += wall;
        }

        const wheelRevsF = wheelRevs0 + wheelRevPerSec * spinSec;
        const crankRevsF = crankRevs0 + crankRevPerSec * spinSec;

        // Advance each event time only while turning — a still wheel reports the
        // same last-event time, which the parser reads as speed zero.
        if (Math.floor(wheelRevsF) > wheelInt) {
            wheelInt = Math.floor(wheelRevsF);
            const secAgo = (wheelRevsF - wheelInt) / wheelRevPerSec;
            wheelEventTicks = Math.round((spinSec - secAgo) * 1024) % 65536;
        }
        if (Math.floor(crankRevsF) > crankInt) {
            crankInt = Math.floor(crankRevsF);
            const secAgo = (crankRevsF - crankInt) / crankRevPerSec;
            crankEventTicks = Math.round((spinSec - secAgo) * 1024) % 65536;
        }

        const dv = new DataView(new ArrayBuffer(11));
        dv.setUint8(0, 0x03);
        dv.setUint32(1, wheelInt, true);
        dv.setUint16(5, wheelEventTicks, true);
        dv.setUint16(7, crankInt % 65536, true);
        dv.setUint16(9, crankEventTicks, true);

        onMeasurement(rider, dv);
    }, 500);
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
        const kinds = [
            st.hasWheel ? "скорость" : null,
            st.hasCrank ? "каденс" : null
        ].filter(Boolean).join(" + ");

        el.textContent =
            `${st.emulating ? "◎ ЭМУЛЯЦИЯ" : "◉ ДАТЧИК"}${kinds ? " · " + kinds : ""}`;
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

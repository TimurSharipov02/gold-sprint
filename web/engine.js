/* =========================================================================
   RACE ENGINE — runs entirely in the browser.

   Ported from the former Go server (the race, rider and sensor packages plus
   runRaceLoop). It drives a 100 ms loop and calls the same handleRaceData() /
   updateRider() functions the WebSocket used to feed, with identical data
   shapes, so app.js and ble.js barely change.

   app.js talks to it through window.engine:
     start(distance, wheel1, wheel2, remote1, remote2)   — a START press
     pushSensor(rider, speedKmh, cadenceRpm, wheelRevs)   — a BLE reading
     setSource(rider, remote)                             — lane source toggle
     state                                                — current race state
   ========================================================================= */

const RACE_TICK_MS = 100;

const STALE_MS = 3000;

// A rider whose speed climbs this many km/h above their slowest during the
// countdown, and stays up for FALSE_START_HOLD_MS, has jumped the start. A wheel
// coasting down from a warm-up spin only ever slows, so it never triggers.
// Timings are wall-clock so the detection is unaffected by tick rate.
const FALSE_START_ACCEL = 4.0;
const FALSE_START_HOLD_MS = 150;
const FALSE_START_GRACE_MS = 400;


function clamp(v, min, max, fallback) {
    return (typeof v === "number" && v >= min && v <= max) ? v : fallback;
}


/* ---- simulated sensor (was sensor/mock.go) ---- */

class MockSensor {

    constructor() {
        this.circMM = 2105;
        this.reset();
    }

    reset() {
        this.speed = 0;
        this.cadence = 0;
        this.wheelRevs = 0;
        // Form for this race: ~42–56 km/h, redrawn every time. (Only the
        // simulation is capped — a real sensor has no ceiling.)
        this.maxSpeed = 42 + Math.random() * 14;
    }

    update(dt) {
        // dt-scaled so a throttled background tab doesn't change the outcome:
        // ~5 km/h per second of acceleration, plus a little noise.
        if (this.speed < this.maxSpeed) {
            this.speed += 5 * dt;
        }
        this.speed += (Math.random() - 0.5) * 2 * dt;

        if (this.speed > this.maxSpeed) {
            this.speed = this.maxSpeed;
        }
        if (this.speed < 0) {
            this.speed = 0;
        }

        this.cadence = this.speed * 2.1;

        const wheelSpeed = this.speed / 3.6; // m/s
        const revPerSec = wheelSpeed / (this.circMM / 1000);
        this.wheelRevs += revPerSec * dt;
    }

    get wheelRevolutions() {
        return this.wheelRevs;
    }
}


/* ---- Bluetooth sensor holder (was sensor/remote.go) ---- */

class RemoteSensor {

    constructor() {
        this.speed = 0;
        this.cadence = 0;
        this.rawWheelRevs = 0;
        this.baselineRevs = 0;
        this.haveBaseline = false;
        this.hasReading = false;
        this.lastPush = 0;
    }

    push(speed, cadence, wheelRevs) {
        this.speed = speed;
        this.cadence = cadence;
        this.rawWheelRevs = wheelRevs;

        if (!this.hasReading || !this.haveBaseline) {
            this.baselineRevs = wheelRevs;
            this.haveBaseline = true;
        }

        this.hasReading = true;
        this.lastPush = performance.now();
    }

    reset() {
        this.speed = 0;
        this.cadence = 0;

        if (this.hasReading) {
            this.baselineRevs = this.rawWheelRevs;
            this.haveBaseline = true;
        } else {
            this.haveBaseline = false;
        }
    }

    // Zero the distance counter at the exact countdown→running moment.
    rebase() {
        this.baselineRevs = this.rawWheelRevs;
        this.haveBaseline = true;
    }

    update() {
        if (this.lastPush && performance.now() - this.lastPush > STALE_MS) {
            this.speed = 0;
            this.cadence = 0;
        }
    }

    get wheelRevolutions() {
        if (!this.haveBaseline) {
            return 0;
        }
        const revs = this.rawWheelRevs - this.baselineRevs;
        return revs < 0 ? 0 : revs;
    }
}


/* ---- rider (was rider/rider.go) ---- */

class Rider {

    constructor(id) {
        this.id = id;
        this.mock = new MockSensor();
        this.remote = new RemoteSensor();
        this.sensor = this.mock;
        this.circMM = 2105;
    }

    setWheel(mm) {
        this.circMM = mm;
        this.mock.circMM = mm;
    }

    reset() {
        this.sensor.reset();
    }

    update(dt) {
        this.sensor.update(dt);
    }

    get speed() {
        return this.sensor.speed;
    }

    get cadence() {
        return this.sensor.cadence;
    }

    get distance() {
        return this.sensor.wheelRevolutions * this.circMM / 1000;
    }

    get isRemote() {
        return this.sensor === this.remote;
    }
}


/* ---- race state machine (was race/race.go) ---- */

const RaceState = {
    READY: "ready",
    COUNTDOWN: "countdown",
    RUNNING: "running",
    FINISHED: "finished"
};

class Race {

    constructor(distance) {
        this.state = RaceState.READY;
        this.distance = distance;
        this.countdown = 0;
        this.falseStartRider = 0;
        this.startTime = 0;
        this.finishTimes = {};
        this.winner = 0;
        this._cdTimer = null;
    }

    start() {
        if (this.state !== RaceState.READY && this.state !== RaceState.FINISHED) {
            return;
        }

        this.state = RaceState.COUNTDOWN;
        this.countdown = 3;
        this.falseStartRider = 0;
        this.finishTimes = {};
        this.winner = 0;

        clearTimeout(this._cdTimer);

        const tick = (n) => {
            if (this.state !== RaceState.COUNTDOWN) {
                return;
            }
            this.countdown = n;
            if (n > 0) {
                this._cdTimer = setTimeout(() => tick(n - 1), 1000);
            } else {
                this._startRunning();
            }
        };

        tick(3);
    }

    _startRunning() {
        if (this.state !== RaceState.COUNTDOWN) {
            return;
        }
        this.state = RaceState.RUNNING;
        this.startTime = performance.now();
        this.countdown = 0;
    }

    falseStart(rider) {
        if (this.state !== RaceState.COUNTDOWN) {
            return false;
        }
        this.state = RaceState.READY;
        this.countdown = 0;
        this.falseStartRider = rider;
        return true;
    }

    finish(rider) {
        if (this.state !== RaceState.RUNNING && this.state !== RaceState.FINISHED) {
            return;
        }
        if (this.finishTimes[rider] != null) {
            return;
        }

        this.finishTimes[rider] = performance.now();

        if (this.winner === 0) {
            this.winner = rider;
            this.state = RaceState.FINISHED;
        }
    }

    isFinished(rider) {
        return this.finishTimes[rider] != null;
    }

    get elapsed() {
        if (this.state === RaceState.RUNNING) {
            return (performance.now() - this.startTime) / 1000;
        }
        if (this.state === RaceState.FINISHED && this.finishTimes[this.winner] != null) {
            return (this.finishTimes[this.winner] - this.startTime) / 1000;
        }
        return 0;
    }

    finishSeconds() {
        if (!this.startTime) {
            return {};
        }
        const out = {};
        for (const id of Object.keys(this.finishTimes)) {
            out[id] = (this.finishTimes[id] - this.startTime) / 1000;
        }
        return out;
    }
}


/* ---- the loop (was server/websocket.go runRaceLoop) ---- */

class Engine {

    constructor() {
        this.race = new Race(250);
        this.riders = [new Rider(1), new Rider(2)];
        this.desiredRemote = [false, false];

        this._prevState = RaceState.READY;
        this._lastTick = performance.now();
        this._minSpeed = [9999, 9999];
        this._jumpSince = [0, 0];
        this._cdElapsed = 0;

        setInterval(() => this._tick(), RACE_TICK_MS);
    }

    get state() {
        return this.race.state;
    }

    // A START press.
    start(distance, wheel1, wheel2, remote1, remote2) {
        this.race.distance = clamp(distance, 10, 100000, 250);
        this.riders[0].setWheel(clamp(wheel1, 1000, 3000, 2105));
        this.riders[1].setWheel(clamp(wheel2, 1000, 3000, 2105));

        this.desiredRemote = [Boolean(remote1), Boolean(remote2)];
        this._pickSensor(0, this.desiredRemote[0]);
        this._pickSensor(1, this.desiredRemote[1]);

        this.riders.forEach((r) => r.reset());

        this._minSpeed = [9999, 9999];
        this._jumpSince = [0, 0];
        this._cdElapsed = 0;

        this.race.start();
        this._lastTick = performance.now();
    }

    // A reading from ble.js. BLE notifications keep firing even when the tab is
    // backgrounded and the loop timer is throttled, so check the finish line
    // here too — that keeps a fast sprint's finish accurate to the reading.
    pushSensor(rider, speed, cadence, wheelRevs) {
        const r = this.riders[rider - 1];
        if (!r) {
            return;
        }

        r.remote.push(speed, cadence, wheelRevs);

        if (r.sensor === r.remote
            && (this.race.state === RaceState.RUNNING || this.race.state === RaceState.FINISHED)
            && !this.race.isFinished(r.id)
            && r.distance >= this.race.distance) {
            this.race.finish(r.id);
        }
    }

    // A lane source toggle from ble.js: a sensor connected or dropped. Applied
    // immediately unless a race is live (mid-race a swap would jump the
    // distance) — in that case it lands on the next return to Ready.
    setSource(rider, remote) {
        const i = rider - 1;
        if (i < 0 || i >= this.riders.length) {
            return;
        }
        this.desiredRemote[i] = Boolean(remote);

        if (this.race.state !== RaceState.RUNNING) {
            this._pickSensor(i, this.desiredRemote[i]);
        }
    }

    _pickSensor(i, remote) {
        this.riders[i].sensor = remote ? this.riders[i].remote : this.riders[i].mock;
    }

    _tick() {
        const now = performance.now();
        // Cap dt so a backgrounded tab that resumes after a long gap advances
        // the race gently instead of teleporting the riders past the line.
        const dt = Math.min((now - this._lastTick) / 1000, 0.5);
        this._lastTick = now;

        const state = this.race.state;

        // Distance counter starts exactly when the race goes live.
        if (state === RaceState.RUNNING && this._prevState !== RaceState.RUNNING) {
            this.riders.forEach((r) => r.remote.rebase());
        }
        // Back to Ready: honour any source change asked for mid-race.
        if (state === RaceState.READY && this._prevState !== RaceState.READY) {
            this.desiredRemote.forEach((rem, i) => this._pickSensor(i, rem));
        }
        this._prevState = state;

        if (state === RaceState.COUNTDOWN) {

            this._cdElapsed += dt;

            if (this._cdElapsed * 1000 > FALSE_START_GRACE_MS) {
                this.riders.forEach((r, i) => {
                    const s = r.speed;

                    if (s < this._minSpeed[i]) {
                        this._minSpeed[i] = s;
                    }

                    if (s > this._minSpeed[i] + FALSE_START_ACCEL) {
                        if (this._jumpSince[i] === 0) {
                            this._jumpSince[i] = now;
                        }
                        if (now - this._jumpSince[i] >= FALSE_START_HOLD_MS) {
                            this.race.falseStart(r.id);
                        }
                    } else {
                        this._jumpSince[i] = 0;
                    }
                });
            }

        } else if (state === RaceState.RUNNING || state === RaceState.FINISHED) {

            this.riders.forEach((r) => {
                if (this.race.isFinished(r.id)) {
                    return;
                }
                r.update(dt);
                if (r.distance >= this.race.distance) {
                    this.race.finish(r.id);
                }
            });
        }

        // Emit — the same shapes the WebSocket used to send.
        handleRaceData({
            type: "race",
            state: this.race.state,
            countdown: this.race.countdown,
            winner: this.race.winner,
            elapsed: this.race.elapsed,
            distance: this.race.distance,
            times: this.race.finishSeconds(),
            falseStart: this.race.falseStartRider
        });

        this.riders.forEach((r) => {
            r.remote.update();
            updateRider({
                rider: r.id,
                speed: r.speed,
                cadence: r.cadence,
                distance: r.distance,
                source: r.isRemote ? "ble" : "mock"
            });
        });
    }
}

window.engine = new Engine();

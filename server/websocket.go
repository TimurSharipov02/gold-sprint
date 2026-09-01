package server

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"gold-sprint/race"
	"gold-sprint/rider"
	"gold-sprint/sensor"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

const (
	defaultDistance = 250
	minDistance     = 10
	maxDistance     = 100000

	defaultWheel = 2105
	minWheel     = 1000
	maxWheel     = 3000

	// A lane that rolls more than this far during the countdown is a rider who
	// jumped the start. Measured from wheel revolutions, so a stale speed
	// reading from a wheel that has actually stopped doesn't trigger it.
	falseStartDistance = 3.0
)

type Command struct {
	Type     string  `json:"type"`
	Distance float64 `json:"distance"`
	Wheel1   float64 `json:"wheel1"`
	Wheel2   float64 `json:"wheel2"`

	// source1/source2 pick each lane's data source for the next race:
	// "ble" for a real Bluetooth sensor, anything else for the simulation.
	Source1 string `json:"source1"`
	Source2 string `json:"source2"`

	// Fields for a "sensor" command — one reading pushed from the browser after
	// it has done the BLE math. Rider is also used by a "source" command, whose
	// Source is "ble" or "mock" and switches that lane between races.
	Rider     int     `json:"rider"`
	Speed     float64 `json:"speed"`
	Cadence   float64 `json:"cadence"`
	WheelRevs float64 `json:"wheelRevs"`
	Source    string  `json:"source"`
}

// sourceChange moves one lane between the simulation and a Bluetooth sensor
// outside of a race, so its live readings show during the pre-start check.
type sourceChange struct {
	rider  int
	remote bool
}

// startParams is a validated race configuration handed from the reader goroutine
// to the race loop, which is the only goroutine allowed to touch the riders.
type startParams struct {
	distance float64
	wheel1   float64
	wheel2   float64
	remote1  bool
	remote2  bool
}

type SensorData struct {
	Rider    int     `json:"rider"`
	Speed    float64 `json:"speed"`
	Cadence  float64 `json:"cadence"`
	Distance float64 `json:"distance"`

	// Source is "ble" while the lane is driven by a real sensor, "mock"
	// otherwise, so the UI can show which readings are live.
	Source string `json:"source"`
}

type RaceData struct {
	Type      string          `json:"type"`
	State     race.State      `json:"state"`
	Countdown int             `json:"countdown"`
	Winner    int             `json:"winner"`
	Elapsed   float64         `json:"elapsed"`
	Distance  float64         `json:"distance"`
	Times     map[int]float64 `json:"times"`

	// FalseStart is the rider that jumped the last countdown, or 0.
	FalseStart int `json:"falseStart"`
}

func WebSocketHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, nil)

	if err != nil {
		return
	}

	defer conn.Close(websocket.StatusNormalClosure, "")

	// Both a simulated and a Bluetooth-fed sensor exist per lane for the whole
	// connection; each race picks which one the rider reads from.
	mocks := []*sensor.MockSensor{
		sensor.NewMock(1, defaultWheel),
		sensor.NewMock(2, defaultWheel),
	}

	remotes := []*sensor.RemoteSensor{
		sensor.NewRemote(),
		sensor.NewRemote(),
	}

	riders := []*rider.Rider{
		rider.New(1, mocks[0], defaultWheel),
		rider.New(2, mocks[1], defaultWheel),
	}

	raceEngine := race.New(defaultDistance)

	// Buffered so a burst of commands never blocks the reader.
	starts := make(chan startParams, 1)
	sources := make(chan sourceChange, 4)

	go readCommands(r.Context(), conn, starts, sources, remotes)

	runRaceLoop(r.Context(), conn, raceEngine, riders, mocks, remotes, starts, sources)
}

func readCommands(
	ctx context.Context,
	conn *websocket.Conn,
	starts chan<- startParams,
	sources chan<- sourceChange,
	remotes []*sensor.RemoteSensor,
) {
	for {
		var command Command

		if err := wsjson.Read(ctx, conn, &command); err != nil {
			return
		}

		switch command.Type {
		case "sensor":
			// A live reading from a Bluetooth sensor. Safe to apply here: the
			// RemoteSensor is mutex-guarded and the race loop only reads it.
			i := command.Rider - 1
			if i >= 0 && i < len(remotes) {
				remotes[i].Push(command.Speed, command.Cadence, command.WheelRevs)
			}
			continue

		case "source":
			if command.Rider == 1 || command.Rider == 2 {
				select {
				case sources <- sourceChange{rider: command.Rider, remote: command.Source == "ble"}:
				case <-ctx.Done():
					return
				}
			}
			continue

		case "start":
			// handled below
		default:
			continue
		}

		params := startParams{
			distance: clamp(command.Distance, minDistance, maxDistance, defaultDistance),
			wheel1:   clamp(command.Wheel1, minWheel, maxWheel, defaultWheel),
			wheel2:   clamp(command.Wheel2, minWheel, maxWheel, defaultWheel),
			remote1:  command.Source1 == "ble",
			remote2:  command.Source2 == "ble",
		}

		fmt.Printf(
			"START: distance=%.0f m, wheel1=%.0f mm (%s), wheel2=%.0f mm (%s)\n",
			params.distance,
			params.wheel1, sourceName(params.remote1),
			params.wheel2, sourceName(params.remote2),
		)

		select {
		case starts <- params:
		case <-ctx.Done():
			return
		}
	}
}

func sourceName(remote bool) string {
	if remote {
		return "ble"
	}

	return "mock"
}

// clamp returns v when it lies within [min, max] and fallback otherwise.
func clamp(v, min, max, fallback float64) float64 {
	if v < min || v > max {
		return fallback
	}

	return v
}

func runRaceLoop(
	ctx context.Context,
	conn *websocket.Conn,
	raceEngine *race.Race,
	riders []*rider.Rider,
	mocks []*sensor.MockSensor,
	remotes []*sensor.RemoteSensor,
	starts <-chan startParams,
	sources <-chan sourceChange,
) {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	lastUpdate := time.Now()
	prevState := raceEngine.GetState()

	for {
		select {
		case <-ctx.Done():
			return

		case sc := <-sources:
			// Only outside a race — mid-race a swap would jump the distance.
			if s := raceEngine.GetState(); s == race.StateReady || s == race.StateFinished {
				i := sc.rider - 1
				pickSensor(riders[i], sc.remote, mocks[i], remotes[i])
			}

		case p := <-starts:
			raceEngine.SetDistance(p.distance)

			riders[0].SetWheelCircumference(p.wheel1)
			riders[1].SetWheelCircumference(p.wheel2)

			pickSensor(riders[0], p.remote1, mocks[0], remotes[0])
			pickSensor(riders[1], p.remote2, mocks[1], remotes[1])

			for _, r := range riders {
				r.Reset()
			}

			raceEngine.Start()

			lastUpdate = time.Now()

		case <-ticker.C:
			now := time.Now()

			dt := now.Sub(lastUpdate).Seconds()

			lastUpdate = now

			state := raceEngine.GetState()

			// The distance counter starts exactly when the race goes live, so
			// warm-up spinning during the countdown never counts.
			if state == race.StateRunning && prevState != race.StateRunning {
				for _, rem := range remotes {
					rem.Rebase()
				}
			}
			prevState = state

			switch state {
			case race.StateCountdown:
				// A rider whose wheel has rolled forward is jumping the start.
				for _, r := range riders {
					if r.Distance() > falseStartDistance {
						raceEngine.FalseStart(r.ID)
					}
				}

			case race.StateRunning, race.StateFinished:
				// Keep advancing riders who haven't crossed yet, even once the
				// race is Finished, so every rider gets a recorded time.
				for _, r := range riders {
					if raceEngine.IsFinished(r.ID) {
						continue
					}

					r.Update(dt)

					if r.Distance() >= raceEngine.GetDistance() {
						raceEngine.Finish(r.ID)
					}
				}
			}

			if err := sendRiderData(ctx, conn, riders); err != nil {
				return
			}

			if err := sendRaceData(ctx, conn, raceEngine); err != nil {
				return
			}
		}
	}
}

// pickSensor points a rider at the simulated or the Bluetooth sensor for the
// coming race.
func pickSensor(
	r *rider.Rider,
	remote bool,
	mock *sensor.MockSensor,
	rem *sensor.RemoteSensor,
) {
	if remote {
		r.SetSensor(rem)
		return
	}

	r.SetSensor(mock)
}

func sendRiderData(
	ctx context.Context,
	conn *websocket.Conn,
	riders []*rider.Rider,
) error {
	for _, r := range riders {
		source := "mock"
		if _, ok := r.Sensor.(*sensor.RemoteSensor); ok {
			source = "ble"
		}

		data := SensorData{
			Rider:    r.ID,
			Speed:    r.Speed(),
			Cadence:  r.Cadence(),
			Distance: r.Distance(),
			Source:   source,
		}

		if err := wsjson.Write(ctx, conn, data); err != nil {
			return err
		}
	}

	return nil
}

func sendRaceData(
	ctx context.Context,
	conn *websocket.Conn,
	raceEngine *race.Race,
) error {
	data := RaceData{
		Type:       "race",
		State:      raceEngine.GetState(),
		Countdown:  raceEngine.GetCountdown(),
		Winner:     raceEngine.GetWinner(),
		Elapsed:    raceEngine.GetElapsed(),
		Distance:   raceEngine.GetDistance(),
		Times:      raceEngine.FinishSeconds(),
		FalseStart: raceEngine.GetFalseStart(),
	}

	return wsjson.Write(ctx, conn, data)
}

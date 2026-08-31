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
)

type Command struct {
	Type     string  `json:"type"`
	Distance float64 `json:"distance"`
	Wheel1   float64 `json:"wheel1"`
	Wheel2   float64 `json:"wheel2"`
}

// startParams is a validated race configuration handed from the reader goroutine
// to the race loop, which is the only goroutine allowed to touch the riders.
type startParams struct {
	distance float64
	wheel1   float64
	wheel2   float64
}

type SensorData struct {
	Rider    int     `json:"rider"`
	Speed    float64 `json:"speed"`
	Cadence  float64 `json:"cadence"`
	Distance float64 `json:"distance"`
}

type RaceData struct {
	Type      string          `json:"type"`
	State     race.State      `json:"state"`
	Countdown int             `json:"countdown"`
	Winner    int             `json:"winner"`
	Elapsed   float64         `json:"elapsed"`
	Distance  float64         `json:"distance"`
	Times     map[int]float64 `json:"times"`
}

func WebSocketHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, nil)

	if err != nil {
		return
	}

	defer conn.Close(websocket.StatusNormalClosure, "")

	riders := []*rider.Rider{
		rider.New(1, sensor.NewMock(1, defaultWheel), defaultWheel),
		rider.New(2, sensor.NewMock(2, defaultWheel), defaultWheel),
	}

	raceEngine := race.New(defaultDistance)

	// Buffered so a burst of start commands never blocks the reader.
	starts := make(chan startParams, 1)

	go readCommands(r.Context(), conn, starts)

	runRaceLoop(r.Context(), conn, raceEngine, riders, starts)
}

func readCommands(
	ctx context.Context,
	conn *websocket.Conn,
	starts chan<- startParams,
) {
	for {
		var command Command

		if err := wsjson.Read(ctx, conn, &command); err != nil {
			return
		}

		if command.Type != "start" {
			continue
		}

		params := startParams{
			distance: clamp(command.Distance, minDistance, maxDistance, defaultDistance),
			wheel1:   clamp(command.Wheel1, minWheel, maxWheel, defaultWheel),
			wheel2:   clamp(command.Wheel2, minWheel, maxWheel, defaultWheel),
		}

		fmt.Printf(
			"START: distance=%.0f m, wheel1=%.0f mm, wheel2=%.0f mm\n",
			params.distance,
			params.wheel1,
			params.wheel2,
		)

		select {
		case starts <- params:
		case <-ctx.Done():
			return
		}
	}
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
	starts <-chan startParams,
) {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	lastUpdate := time.Now()

	for {
		select {
		case <-ctx.Done():
			return

		case p := <-starts:
			raceEngine.SetDistance(p.distance)

			riders[0].SetWheelCircumference(p.wheel1)
			riders[1].SetWheelCircumference(p.wheel2)

			for _, r := range riders {
				r.Reset()
			}

			raceEngine.Start()

			lastUpdate = time.Now()

		case <-ticker.C:
			now := time.Now()

			dt := now.Sub(lastUpdate).Seconds()

			lastUpdate = now

			// Keep advancing riders who haven't crossed yet, even once the race
			// is Finished, so every rider gets a recorded time.
			switch raceEngine.GetState() {
			case race.StateRunning, race.StateFinished:
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

func sendRiderData(
	ctx context.Context,
	conn *websocket.Conn,
	riders []*rider.Rider,
) error {
	for _, r := range riders {
		data := SensorData{
			Rider:    r.ID,
			Speed:    r.Speed(),
			Cadence:  r.Cadence(),
			Distance: r.Distance(),
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
		Type:      "race",
		State:     raceEngine.GetState(),
		Countdown: raceEngine.GetCountdown(),
		Winner:    raceEngine.GetWinner(),
		Elapsed:   raceEngine.GetElapsed(),
		Distance:  raceEngine.GetDistance(),
		Times:     raceEngine.FinishSeconds(),
	}

	return wsjson.Write(ctx, conn, data)
}

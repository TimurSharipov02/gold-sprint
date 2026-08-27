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

type Command struct {
	Type     string  `json:"type"`
	Distance float64 `json:"distance"`
	Wheel1   float64 `json:"wheel1"`
	Wheel2   float64 `json:"wheel2"`
}

type SensorData struct {
	Rider    int     `json:"rider"`
	Speed    float64 `json:"speed"`
	Cadence  float64 `json:"cadence"`
	Distance float64 `json:"distance"`
}

type RaceData struct {
	Type      string     `json:"type"`
	State     race.State `json:"state"`
	Countdown int        `json:"countdown"`
	Winner    int        `json:"winner"`
	Elapsed   float64    `json:"elapsed"`
	Distance  float64    `json:"distance"`
}

func WebSocketHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, nil)

	if err != nil {
		return
	}

	defer conn.CloseNow()

	riders := []*rider.Rider{
		rider.New(
			1,
			sensor.NewMock(1),
			2105,
		),

		rider.New(
			2,
			sensor.NewMock(2),
			2105,
		),
	}

	raceEngine := race.New(250)

	go readCommands(
		r.Context(),
		conn,
		raceEngine,
		riders,
	)

	runRaceLoop(
		r.Context(),
		conn,
		raceEngine,
		riders,
	)
}

func readCommands(
	ctx context.Context,
	conn *websocket.Conn,
	raceEngine *race.Race,
	riders []*rider.Rider,
) {
	for {
		var command Command

		err := wsjson.Read(
			ctx,
			conn,
			&command,
		)

		if err != nil {
			return
		}

		if command.Type != "start" {
			continue
		}

		raceEngine.SetDistance(command.Distance)

		riders[0].SetWheelCircumference(command.Wheel1)
		riders[1].SetWheelCircumference(command.Wheel2)

		fmt.Printf(
			"START: distance=%.0f m, wheel1=%.0f mm, wheel2=%.0f mm\n",
			command.Distance,
			command.Wheel1,
			command.Wheel2,
		)

		for _, r := range riders {
			r.Reset()
		}

		raceEngine.Start()
	}
}

func runRaceLoop(
	ctx context.Context,
	conn *websocket.Conn,
	raceEngine *race.Race,
	riders []*rider.Rider,
) {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	lastUpdate := time.Now()

	for {
		select {
		case <-ctx.Done():
			return

		case <-ticker.C:
			now := time.Now()

			dt := now.Sub(lastUpdate).Seconds()

			lastUpdate = now

			if raceEngine.GetState() == race.StateRunning {
				for _, r := range riders {
					r.Update(dt)

					if r.Distance() >= raceEngine.GetDistance() {
						raceEngine.Finish(r.ID)
					}
				}
			}

			sendRiderData(
				ctx,
				conn,
				riders,
			)

			sendRaceData(
				ctx,
				conn,
				raceEngine,
			)
		}
	}
}

func sendRiderData(
	ctx context.Context,
	conn *websocket.Conn,
	riders []*rider.Rider,
) {
	for _, r := range riders {
		data := SensorData{
			Rider:    r.ID,
			Speed:    r.Speed(),
			Cadence:  r.Cadence(),
			Distance: r.Distance(),
		}

		if err := wsjson.Write(
			ctx,
			conn,
			data,
		); err != nil {
			return
		}
	}
}

func sendRaceData(
	ctx context.Context,
	conn *websocket.Conn,
	raceEngine *race.Race,
) {
	data := RaceData{
		Type:      "race",
		State:     raceEngine.GetState(),
		Countdown: raceEngine.GetCountdown(),
		Winner:    raceEngine.GetWinner(),
		Elapsed:   raceEngine.GetElapsed(),
		Distance:  raceEngine.GetDistance(),
	}

	_ = wsjson.Write(
		ctx,
		conn,
		data,
	)
}

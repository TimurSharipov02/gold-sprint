package race

import (
	"sync"
	"time"
)

type State string

const (
	StateReady     State = "ready"
	StateCountdown State = "countdown"
	StateRunning   State = "running"
	StateFinished  State = "finished"
)

type Race struct {
	mu sync.Mutex

	State    State
	Distance float64

	Countdown int

	StartTime  time.Time
	FinishTime map[int]time.Time
	Winner     int

	WheelCircumference map[int]float64
}

func New(distance float64) *Race {
	return &Race{
		State:      StateReady,
		Distance:   distance,
		FinishTime: make(map[int]time.Time),

		WheelCircumference: map[int]float64{
			1: 2105,
			2: 2105,
		},
	}
}

func (r *Race) Start() {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.State != StateReady && r.State != StateFinished {
		return
	}

	r.State = StateCountdown
	r.Countdown = 3

	r.FinishTime = make(map[int]time.Time)
	r.Winner = 0

	go func() {
		for i := 3; i > 0; i-- {
			r.mu.Lock()
			r.Countdown = i
			r.mu.Unlock()

			time.Sleep(time.Second)
		}

		r.StartRunning()
	}()
}

func (r *Race) StartRunning() {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.State = StateRunning
	r.StartTime = time.Now()
	r.Countdown = 0
}

func (r *Race) Finish(rider int) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.State != StateRunning {
		return
	}

	if _, exists := r.FinishTime[rider]; exists {
		return
	}

	r.FinishTime[rider] = time.Now()

	if r.Winner == 0 {
		r.Winner = rider
		r.State = StateFinished
	}
}

func (r *Race) SetDistance(distance float64) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.Distance = distance
}

func (r *Race) SetWheelCircumference(
	rider int,
	circumference float64,
) {
	if circumference <= 0 {
		return
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	r.WheelCircumference[rider] = circumference
}

func (r *Race) GetWheelCircumference(rider int) float64 {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.WheelCircumference[rider]
}

func (r *Race) GetDistance() float64 {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.Distance
}

func (r *Race) GetState() State {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.State
}

func (r *Race) GetCountdown() int {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.Countdown
}

func (r *Race) GetWinner() int {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.Winner
}

func (r *Race) GetElapsed() float64 {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.State != StateRunning {
		return 0
	}

	return time.Since(r.StartTime).Seconds()
}

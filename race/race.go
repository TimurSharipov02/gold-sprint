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

	// countdownStep is the delay between countdown ticks. It is a field so
	// tests can shrink it instead of waiting whole seconds; it is only ever
	// set before Start is called.
	countdownStep time.Duration

	State    State
	Distance float64

	Countdown int

	// FalseStartRider is the rider that jumped the countdown on the most recent
	// aborted start, or 0. Cleared by the next Start.
	FalseStartRider int

	StartTime  time.Time
	FinishTime map[int]time.Time
	Winner     int
}

func New(distance float64) *Race {
	return &Race{
		State:         StateReady,
		Distance:      distance,
		FinishTime:    make(map[int]time.Time),
		countdownStep: time.Second,
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

	r.FalseStartRider = 0
	r.FinishTime = make(map[int]time.Time)
	r.Winner = 0

	go func() {
		for i := 3; i > 0; i-- {
			r.mu.Lock()
			r.Countdown = i
			r.mu.Unlock()

			time.Sleep(r.countdownStep)
		}

		r.startRunning()
	}()
}

func (r *Race) startRunning() {
	r.mu.Lock()
	defer r.mu.Unlock()

	// A new race may have been requested, or the countdown aborted on a false
	// start, while we were counting down.
	if r.State != StateCountdown {
		return
	}

	r.State = StateRunning
	r.StartTime = time.Now()
	r.Countdown = 0
}

// FalseStart aborts an in-progress countdown because a rider started pedalling
// early, dropping back to Ready so the start can be re-run. It reports whether
// there was a countdown to abort.
func (r *Race) FalseStart(rider int) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.State != StateCountdown {
		return false
	}

	r.State = StateReady
	r.Countdown = 0
	r.FalseStartRider = rider

	return true
}

func (r *Race) GetFalseStart() int {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.FalseStartRider
}

func (r *Race) Finish(rider int) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// The first finisher flips the race to Finished and takes the win, but the
	// other riders keep rolling until they cross too, so a qualifying heat can
	// record a time for everyone on the track.
	if r.State != StateRunning && r.State != StateFinished {
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

// IsFinished reports whether the given rider has already crossed the line.
func (r *Race) IsFinished(rider int) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	_, ok := r.FinishTime[rider]

	return ok
}

// FinishSeconds returns each rider's finishing time in seconds from the start.
// Riders still on the track are absent from the map.
func (r *Race) FinishSeconds() map[int]float64 {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.StartTime.IsZero() {
		return nil
	}

	out := make(map[int]float64, len(r.FinishTime))

	for id, t := range r.FinishTime {
		out[id] = t.Sub(r.StartTime).Seconds()
	}

	return out
}

func (r *Race) SetDistance(distance float64) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.Distance = distance
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

// GetElapsed returns the running time in seconds: the live time while the race
// is running, and the winner's finishing time once it is finished.
func (r *Race) GetElapsed() float64 {
	r.mu.Lock()
	defer r.mu.Unlock()

	switch r.State {
	case StateRunning:
		return time.Since(r.StartTime).Seconds()

	case StateFinished:
		if t, ok := r.FinishTime[r.Winner]; ok {
			return t.Sub(r.StartTime).Seconds()
		}
	}

	return 0
}

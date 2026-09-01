package sensor

import (
	"sync"
	"time"
)

// staleAfter is how long a RemoteSensor keeps trusting its last reading. If the
// browser stops pushing (sensor asleep, Bluetooth dropped), speed and cadence
// fall back to zero so a rider doesn't coast forever on a frozen value.
const staleAfter = 3 * time.Second

// RemoteSensor is fed by a real Bluetooth speed/cadence sensor over the
// WebSocket. The browser does the BLE math and pushes speed (km/h), cadence
// (rpm) and the sensor's cumulative wheel-revolution counter; this type just
// holds the latest values for the race loop to read.
//
// It is written by the connection's reader goroutine and read by the race loop,
// so every field access goes through the mutex.
type RemoteSensor struct {
	mu sync.Mutex

	speed   float64
	cadence float64

	// rawWheelRevs is the sensor's own cumulative counter; baselineRevs is its
	// value at the last Reset, so WheelRevolutions() counts from zero each race.
	rawWheelRevs float64
	baselineRevs float64
	haveBaseline bool

	lastPush time.Time
	now      func() time.Time // swappable for tests
}

func NewRemote() *RemoteSensor {
	return &RemoteSensor{now: time.Now}
}

// Push records a fresh reading from the browser.
func (s *RemoteSensor) Push(speed, cadence, wheelRevs float64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.speed = speed
	s.cadence = cadence
	s.rawWheelRevs = wheelRevs

	if !s.haveBaseline {
		s.baselineRevs = wheelRevs
		s.haveBaseline = true
	}

	s.lastPush = s.now()
}

// Reset re-zeros the distance counter for a new race. The baseline is taken from
// the next reading rather than now, so a race that starts before any data has
// arrived still measures distance from zero.
func (s *RemoteSensor) Reset() {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.speed = 0
	s.cadence = 0
	s.haveBaseline = false
	s.baselineRevs = s.rawWheelRevs
}

// Update has nothing to advance — data arrives asynchronously — but it drops a
// stale reading to zero so a disconnected sensor stops the rider.
func (s *RemoteSensor) Update(float64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.lastPush.IsZero() && s.now().Sub(s.lastPush) > staleAfter {
		s.speed = 0
		s.cadence = 0
	}
}

func (s *RemoteSensor) Speed() float64 {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.speed
}

func (s *RemoteSensor) Cadence() float64 {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.cadence
}

// WheelRevolutions returns revolutions since the last Reset, so rider.Distance()
// measures the current race only.
func (s *RemoteSensor) WheelRevolutions() float64 {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.haveBaseline {
		return 0
	}

	revs := s.rawWheelRevs - s.baselineRevs
	if revs < 0 {
		return 0
	}

	return revs
}

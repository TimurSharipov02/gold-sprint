package sensor

import (
	"testing"
	"time"
)

func TestRemoteSensorHoldsLatestPush(t *testing.T) {
	s := NewRemote()

	s.Push(31.5, 88, 100)

	if s.Speed() != 31.5 {
		t.Fatalf("speed = %v, want 31.5", s.Speed())
	}

	if s.Cadence() != 88 {
		t.Fatalf("cadence = %v, want 88", s.Cadence())
	}
}

func TestRemoteSensorDistanceCountsFromReset(t *testing.T) {
	s := NewRemote()

	// Sensor has been running for a while before this race.
	s.Push(20, 80, 5000)

	s.Reset()

	// First reading after Reset sets the baseline.
	s.Push(20, 80, 5000)
	if got := s.WheelRevolutions(); got != 0 {
		t.Fatalf("revs right after reset = %v, want 0", got)
	}

	s.Push(20, 80, 5040)
	if got := s.WheelRevolutions(); got != 40 {
		t.Fatalf("revs = %v, want 40", got)
	}
}

func TestRemoteSensorResetBeforeAnyData(t *testing.T) {
	s := NewRemote()

	// A race starts before the browser has pushed anything.
	s.Reset()

	if got := s.WheelRevolutions(); got != 0 {
		t.Fatalf("revs = %v, want 0", got)
	}

	// The first reading becomes the baseline even though it arrives late.
	s.Push(15, 70, 12345)
	if got := s.WheelRevolutions(); got != 0 {
		t.Fatalf("revs = %v, want 0", got)
	}

	s.Push(15, 70, 12360)
	if got := s.WheelRevolutions(); got != 15 {
		t.Fatalf("revs = %v, want 15", got)
	}
}

func TestRemoteSensorGoesStale(t *testing.T) {
	now := time.Now()

	s := NewRemote()
	s.now = func() time.Time { return now }

	s.Push(40, 95, 10)

	// Still fresh.
	s.Update(0.1)
	if s.Speed() != 40 {
		t.Fatalf("speed went stale early: %v", s.Speed())
	}

	// Browser has gone quiet.
	now = now.Add(4 * time.Second)
	s.Update(0.1)

	if s.Speed() != 0 || s.Cadence() != 0 {
		t.Fatalf("stale reading not zeroed: speed=%v cadence=%v", s.Speed(), s.Cadence())
	}
}

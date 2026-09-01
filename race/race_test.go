package race

import (
	"testing"
	"time"
)

// newFast builds a race whose countdown ticks fast so tests do not wait whole
// seconds.
func newFast(distance float64) *Race {
	r := New(distance)
	r.countdownStep = time.Millisecond

	return r
}

// waitState polls until the race reaches want or the deadline passes.
func waitState(t *testing.T, r *Race, want State) {
	t.Helper()

	deadline := time.Now().Add(time.Second)

	for time.Now().Before(deadline) {
		if r.GetState() == want {
			return
		}

		time.Sleep(time.Millisecond)
	}

	t.Fatalf("state %q not reached, still %q", want, r.GetState())
}

func TestNewStartsReady(t *testing.T) {
	r := New(250)

	if r.GetState() != StateReady {
		t.Fatalf("got %q, want %q", r.GetState(), StateReady)
	}
}

func TestStartEntersCountdownImmediately(t *testing.T) {
	r := newFast(250)
	r.Start()

	if got := r.GetState(); got != StateCountdown {
		t.Fatalf("got %q, want %q", got, StateCountdown)
	}

	if got := r.GetCountdown(); got != 3 {
		t.Fatalf("countdown = %d, want 3", got)
	}
}

func TestCountdownReachesRunning(t *testing.T) {
	r := newFast(250)
	r.Start()

	waitState(t, r, StateRunning)

	if got := r.GetCountdown(); got != 0 {
		t.Fatalf("countdown = %d, want 0", got)
	}
}

func TestStartIgnoredWhileRunning(t *testing.T) {
	r := newFast(250)
	r.Start()
	waitState(t, r, StateRunning)

	start := r.StartTime

	r.Start() // must be a no-op

	if r.GetState() != StateRunning {
		t.Fatalf("state changed to %q", r.GetState())
	}

	if !r.StartTime.Equal(start) {
		t.Fatal("StartTime was reset by a second Start()")
	}
}

func TestFinishIgnoredWhenNotRunning(t *testing.T) {
	r := New(250)

	r.Finish(1)

	if r.GetWinner() != 0 {
		t.Fatalf("winner = %d, want 0", r.GetWinner())
	}

	if r.GetState() != StateReady {
		t.Fatalf("state = %q, want %q", r.GetState(), StateReady)
	}
}

func TestFirstFinisherWins(t *testing.T) {
	r := newFast(250)
	r.Start()
	waitState(t, r, StateRunning)

	r.Finish(2)
	r.Finish(1) // too late

	if got := r.GetWinner(); got != 2 {
		t.Fatalf("winner = %d, want 2", got)
	}

	if got := r.GetState(); got != StateFinished {
		t.Fatalf("state = %q, want %q", got, StateFinished)
	}
}

func TestDuplicateFinishIgnored(t *testing.T) {
	r := newFast(250)
	r.Start()
	waitState(t, r, StateRunning)

	r.Finish(1)
	first := r.FinishTime[1]

	r.Finish(1)

	if !r.FinishTime[1].Equal(first) {
		t.Fatal("duplicate Finish overwrote the finish time")
	}
}

func TestElapsedReportsWinnerTimeWhenFinished(t *testing.T) {
	r := newFast(250)
	r.Start()
	waitState(t, r, StateRunning)

	time.Sleep(20 * time.Millisecond)
	r.Finish(1)

	elapsed := r.GetElapsed()

	if elapsed <= 0 {
		t.Fatalf("elapsed = %v, want > 0", elapsed)
	}

	// Must be stable after finishing.
	time.Sleep(10 * time.Millisecond)

	if got := r.GetElapsed(); got != elapsed {
		t.Fatalf("elapsed changed after finish: %v -> %v", elapsed, got)
	}
}

func TestLateFinishersAreStillRecorded(t *testing.T) {
	r := newFast(250)
	r.Start()
	waitState(t, r, StateRunning)

	r.Finish(1)
	r.Finish(2) // crosses after the race is already Finished

	if got := r.GetWinner(); got != 1 {
		t.Fatalf("winner = %d, want 1", got)
	}

	if _, ok := r.FinishTime[2]; !ok {
		t.Fatal("second finisher was not recorded")
	}
}

func TestFinishSecondsReportsEveryFinisher(t *testing.T) {
	r := newFast(250)
	r.Start()
	waitState(t, r, StateRunning)

	time.Sleep(10 * time.Millisecond)
	r.Finish(2)
	r.Finish(1)

	seconds := r.FinishSeconds()

	if len(seconds) != 2 {
		t.Fatalf("got %d times, want 2", len(seconds))
	}

	for id, s := range seconds {
		if s <= 0 {
			t.Fatalf("rider %d time = %v, want > 0", id, s)
		}
	}
}

func TestFinishSecondsEmptyBeforeStart(t *testing.T) {
	r := New(250)

	if got := r.FinishSeconds(); got != nil {
		t.Fatalf("FinishSeconds = %v, want nil before the race starts", got)
	}
}

func TestFalseStartAbortsCountdown(t *testing.T) {
	r := New(250)
	r.countdownStep = 50 * time.Millisecond
	r.Start()

	if !r.FalseStart(2) {
		t.Fatal("FalseStart returned false during countdown")
	}

	if got := r.GetState(); got != StateReady {
		t.Fatalf("state = %q, want %q", got, StateReady)
	}

	if got := r.GetFalseStart(); got != 2 {
		t.Fatalf("false-start rider = %d, want 2", got)
	}

	// The aborted countdown must not go on to start the race.
	waitState(t, r, StateReady)
	time.Sleep(200 * time.Millisecond)

	if got := r.GetState(); got != StateReady {
		t.Fatalf("race started after a false start: state = %q", got)
	}
}

func TestFalseStartIgnoredOutsideCountdown(t *testing.T) {
	r := New(250)

	if r.FalseStart(1) {
		t.Fatal("FalseStart succeeded while Ready")
	}

	if r.GetFalseStart() != 0 {
		t.Fatalf("false-start rider set to %d while Ready", r.GetFalseStart())
	}
}

func TestStartClearsFalseStart(t *testing.T) {
	r := newFast(250)
	r.Start()
	r.FalseStart(1)

	r.Start()

	if got := r.GetFalseStart(); got != 0 {
		t.Fatalf("false-start rider = %d after restart, want 0", got)
	}
}

func TestSetDistance(t *testing.T) {
	r := New(250)

	r.SetDistance(500)

	if got := r.GetDistance(); got != 500 {
		t.Fatalf("distance = %v, want 500", got)
	}
}

package sensor

type Sensor interface {
	Reset()

	Update(dt float64)

	Speed() float64

	Cadence() float64

	WheelRevolutions() float64
}

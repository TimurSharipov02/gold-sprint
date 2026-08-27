package rider

import (
	"gold-sprint/sensor"
)

type Rider struct {
	ID int

	Sensor sensor.Sensor

	WheelCircumference float64
}

func New(
	id int,
	s sensor.Sensor,
	wheelCircumference float64,
) *Rider {
	return &Rider{
		ID:                 id,
		Sensor:             s,
		WheelCircumference: wheelCircumference,
	}
}

func (r *Rider) Reset() {
	r.Sensor.Reset()
}

func (r *Rider) Update(dt float64) {
	r.Sensor.Update(dt)
}

func (r *Rider) Speed() float64 {
	return r.Sensor.Speed()
}

func (r *Rider) Cadence() float64 {
	return r.Sensor.Cadence()
}

func (r *Rider) Distance() float64 {
	return r.Sensor.WheelRevolutions() *
		r.WheelCircumference /
		1000
}

func (r *Rider) SetWheelCircumference(
	circumference float64,
) {
	if circumference > 0 {
		r.WheelCircumference = circumference
	}
}

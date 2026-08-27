package sensor

import "math/rand"

type MockSensor struct {
	Rider int

	speed            float64
	cadence          float64
	wheelRevolutions float64
}

func NewMock(rider int) *MockSensor {
	return &MockSensor{
		Rider: rider,
	}
}

func (s *MockSensor) Reset() {
	s.speed = 0
	s.cadence = 0
	s.wheelRevolutions = 0
}

func (s *MockSensor) Update(dt float64) {

	// Разгон.
	if s.speed < 45 {
		s.speed += 0.5
	}

	// Второй гонщик немного медленнее.
	if s.Rider == 2 {
		s.speed -= 0.1
	}

	// Небольшое случайное изменение.
	s.speed += (rand.Float64() - 0.5) * 0.2

	// Ограничения.
	if s.speed > 47 {
		s.speed = 47
	}

	if s.speed < 0 {
		s.speed = 0
	}

	// Пока каденс имитируем.
	s.cadence = s.speed * 2.1

	// Имитация оборотов колеса.
	wheelCircumference := 2.1

	wheelSpeed := s.speed / 3.6

	revolutionsPerSecond :=
		wheelSpeed / wheelCircumference

	s.wheelRevolutions +=
		revolutionsPerSecond * dt
}

func (s *MockSensor) Speed() float64 {
	return s.speed
}

func (s *MockSensor) Cadence() float64 {
	return s.cadence
}

func (s *MockSensor) WheelRevolutions() float64 {
	return s.wheelRevolutions
}

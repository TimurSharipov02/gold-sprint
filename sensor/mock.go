package sensor

import "math/rand"

// defaultWheelCircumferenceMM is the physical wheel used by the simulation when
// the caller does not supply one.
const defaultWheelCircumferenceMM = 2105

type MockSensor struct {
	Rider int

	// wheelCircumference is the physical circumference of the simulated wheel,
	// in metres. It is used to convert the simulated speed into wheel
	// revolutions, exactly as a real speed sensor would report them.
	wheelCircumference float64

	speed            float64
	cadence          float64
	wheelRevolutions float64

	// maxSpeed is redrawn on every Reset so repeated races between the same
	// riders produce different results — a tournament bracket would be pointless
	// otherwise.
	maxSpeed float64
}

func NewMock(rider int, wheelCircumferenceMM float64) *MockSensor {
	if wheelCircumferenceMM <= 0 {
		wheelCircumferenceMM = defaultWheelCircumferenceMM
	}

	return &MockSensor{
		Rider:              rider,
		wheelCircumference: wheelCircumferenceMM / 1000,
	}
}

func (s *MockSensor) Reset() {
	s.speed = 0
	s.cadence = 0
	s.wheelRevolutions = 0

	// Форма гонщика на этот заезд: 40–48 км/ч.
	s.maxSpeed = 40 + rand.Float64()*8
}

func (s *MockSensor) Update(dt float64) {

	if s.maxSpeed == 0 {
		s.maxSpeed = 44
	}

	// Разгон.
	if s.speed < s.maxSpeed {
		s.speed += 0.5
	}

	// Небольшое случайное изменение.
	s.speed += (rand.Float64() - 0.5) * 0.2

	// Ограничения.
	if s.speed > s.maxSpeed {
		s.speed = s.maxSpeed
	}

	if s.speed < 0 {
		s.speed = 0
	}

	// Пока каденс имитируем.
	s.cadence = s.speed * 2.1

	// Имитация оборотов колеса на основе физической окружности.
	wheelSpeed := s.speed / 3.6

	revolutionsPerSecond := wheelSpeed / s.wheelCircumference

	s.wheelRevolutions += revolutionsPerSecond * dt
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

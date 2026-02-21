// Package animals demonstrates inheritance-like patterns in Go
package animals

// BaseAnimal contains common animal properties
type BaseAnimal struct {
	Name string
	Age  int
}

// MakeSound returns a generic animal sound
func (a *BaseAnimal) MakeSound() string {
	return "Some generic sound"
}

// Dog embeds BaseAnimal to achieve composition-based inheritance
type Dog struct {
	BaseAnimal // Embedded struct (inheritance-like pattern)
	Breed      string
}

// MakeSound overrides the base sound for dogs
func (d *Dog) MakeSound() string {
	return "Woof!"
}

// Fetch is a dog-specific method
func (d *Dog) Fetch() string {
	return d.Name + " is fetching!"
}

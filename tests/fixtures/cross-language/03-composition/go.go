// Package models contains domain models with composition
package models

// Address represents a physical address
type Address struct {
	Street string
	City   string
}

// GetFullAddress returns the complete address string
func (a *Address) GetFullAddress() string {
	return a.Street + ", " + a.City
}

// Person represents a person with an address
type Person struct {
	Name    string
	Address Address // embedded/composed field
}

// GetPersonInfo returns person information with address
func (p *Person) GetPersonInfo() string {
	return p.Name + " lives at " + p.Address.GetFullAddress()
}

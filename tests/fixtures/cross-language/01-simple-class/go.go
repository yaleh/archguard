// Package models contains domain models
package models

// User represents a user in the system
type User struct {
	id   string
	Name string
}

// GetName returns the user's name
func (u *User) GetName() string {
	return u.Name
}

// SetId updates the user's id
func (u *User) SetId(newId string) {
	u.id = newId
}

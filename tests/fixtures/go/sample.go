package main

// User represents a user in the system
type User struct {
	ID   int
	Name string
	age  int
}

// Runner defines the interface for runnable services
type Runner interface {
	Start()
	Stop()
}

// Service implements the Runner interface
type Service struct {
	Name   string
	Status string
}

// Start starts the service
func (s *Service) Start() {
	s.Status = "running"
}

// Stop stops the service
func (s *Service) Stop() {
	s.Status = "stopped"
}

// GetName returns the user's name
func (u *User) GetName() string {
	return u.Name
}

// SetName updates the user's name
func (u *User) SetName(name string) {
	u.Name = name
}

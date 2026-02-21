// Package repository contains data access interfaces and implementations
package repository

// IRepository defines the interface for data repositories
type IRepository interface {
	FindById(id string) *string
	Save(id string, data string)
}

// InMemoryRepository implements IRepository using in-memory storage
type InMemoryRepository struct {
	data map[string]string
}

// FindById retrieves data by ID
func (r *InMemoryRepository) FindById(id string) *string {
	if val, ok := r.data[id]; ok {
		return &val
	}
	return nil
}

// Save stores data with the given ID
func (r *InMemoryRepository) Save(id string, data string) {
	r.data[id] = data
}

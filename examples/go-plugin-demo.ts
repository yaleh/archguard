/**
 * Go Plugin Demo
 *
 * Demonstrates the Go plugin parsing capabilities
 */

import { GoPlugin } from '../src/plugins/golang/index.js';

async function main() {
  const plugin = new GoPlugin();
  await plugin.initialize({ workspaceRoot: '/tmp' });

  const sampleCode = `
package service

import (
  "context"
  "errors"
)

// UserService defines operations for user management
type UserService interface {
  GetUser(ctx context.Context, id int) (*User, error)
  CreateUser(ctx context.Context, user *User) error
  DeleteUser(ctx context.Context, id int) error
}

// User represents a user entity
type User struct {
  ID       int
  Username string
  Email    string
  password string
}

// InMemoryUserService is an in-memory implementation of UserService
type InMemoryUserService struct {
  users map[int]*User
}

// GetUser retrieves a user by ID
func (s *InMemoryUserService) GetUser(ctx context.Context, id int) (*User, error) {
  user, exists := s.users[id]
  if !exists {
    return nil, errors.New("user not found")
  }
  return user, nil
}

// CreateUser creates a new user
func (s *InMemoryUserService) CreateUser(ctx context.Context, user *User) error {
  s.users[user.ID] = user
  return nil
}

// DeleteUser deletes a user
func (s *InMemoryUserService) DeleteUser(ctx context.Context, id int) error {
  delete(s.users, id)
  return nil
}

// GetUsername returns the username
func (u *User) GetUsername() string {
  return u.Username
}

// SetPassword sets the password (unexported field)
func (u *User) SetPassword(pwd string) {
  u.password = pwd
}
`;

  console.log('=== Go Plugin Demo ===\n');
  console.log('Parsing Go code...\n');

  const result = plugin.parseCode(sampleCode, 'service/user.go');

  console.log('Language:', result.language);
  console.log('Version:', result.version);
  console.log('Source Files:', result.sourceFiles);
  console.log('\n=== Entities ===');
  console.log(`Found ${result.entities.length} entities:\n`);

  for (const entity of result.entities) {
    console.log(`${entity.type.toUpperCase()}: ${entity.name}`);
    console.log(`  ID: ${entity.id}`);
    console.log(`  Visibility: ${entity.visibility}`);
    console.log(`  Members: ${entity.members.length}`);

    const fields = entity.members.filter(m => m.type === 'field');
    const methods = entity.members.filter(m => m.type === 'method');

    if (fields.length > 0) {
      console.log(`  Fields (${fields.length}):`);
      for (const field of fields) {
        console.log(`    - ${field.name}: ${field.fieldType} (${field.visibility})`);
      }
    }

    if (methods.length > 0) {
      console.log(`  Methods (${methods.length}):`);
      for (const method of methods) {
        const params = method.parameters?.map(p => `${p.name}: ${p.type}`).join(', ') || '';
        console.log(`    - ${method.name}(${params}): ${method.returnType} (${method.visibility})`);
      }
    }

    console.log(`  Location: ${entity.sourceLocation.file}:${entity.sourceLocation.startLine}-${entity.sourceLocation.endLine}`);
    console.log();
  }

  console.log('=== Relations ===');
  console.log(`Found ${result.relations.length} relations:\n`);

  for (const relation of result.relations) {
    console.log(`${relation.type.toUpperCase()}: ${relation.source} -> ${relation.target}`);
    console.log(`  Confidence: ${relation.confidence}`);
    console.log(`  Source: ${relation.inferenceSource}`);
    console.log();
  }

  console.log('=== Summary ===');
  console.log(`Total Entities: ${result.entities.length}`);
  console.log(`  Structs: ${result.entities.filter(e => e.type === 'struct').length}`);
  console.log(`  Interfaces: ${result.entities.filter(e => e.type === 'interface').length}`);
  console.log(`Total Relations: ${result.relations.length}`);
  console.log(`  Implementations: ${result.relations.filter(r => r.type === 'implementation').length}`);

  await plugin.dispose();
}

main().catch(console.error);

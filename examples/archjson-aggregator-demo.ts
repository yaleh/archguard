/**
 * ArchJSONAggregator Demo
 *
 * Demonstrates the three-level detail aggregation feature (v2.0 core innovation)
 *
 * Run with: npm run build && node dist/examples/archjson-aggregator-demo.js
 */

import { ArchJSONAggregator } from '../src/parser/archjson-aggregator.js';
import type { ArchJSON } from '../src/types/index.js';

// Sample ArchJSON data
const sampleArchJSON: ArchJSON = {
  version: '1.0',
  language: 'typescript',
  timestamp: new Date().toISOString(),
  sourceFiles: [
    'src/services/user-service.ts',
    'src/services/auth-service.ts',
    'src/repositories/user-repository.ts',
    'src/repositories/session-repository.ts',
    'src/models/user.ts',
  ],
  entities: [
    {
      id: 'src.services.UserService',
      name: 'UserService',
      type: 'class',
      visibility: 'public',
      sourceLocation: { file: 'src/services/user-service.ts', startLine: 10, endLine: 50 },
      members: [
        {
          name: 'getUser',
          type: 'method',
          visibility: 'public',
          returnType: 'Promise<User>',
          parameters: [{ name: 'id', type: 'string' }],
        },
        {
          name: 'createUser',
          type: 'method',
          visibility: 'public',
          returnType: 'Promise<User>',
          parameters: [{ name: 'data', type: 'CreateUserDTO' }],
        },
        {
          name: 'validateUserData',
          type: 'method',
          visibility: 'private',
          returnType: 'boolean',
          parameters: [{ name: 'data', type: 'CreateUserDTO' }],
        },
        {
          name: 'userRepository',
          type: 'property',
          visibility: 'private',
          fieldType: 'UserRepository',
        },
      ],
    },
    {
      id: 'src.services.AuthService',
      name: 'AuthService',
      type: 'class',
      visibility: 'public',
      sourceLocation: { file: 'src/services/auth-service.ts', startLine: 10, endLine: 60 },
      members: [
        {
          name: 'login',
          type: 'method',
          visibility: 'public',
          returnType: 'Promise<Session>',
          parameters: [
            { name: 'email', type: 'string' },
            { name: 'password', type: 'string' },
          ],
        },
        {
          name: 'logout',
          type: 'method',
          visibility: 'public',
          returnType: 'Promise<void>',
          parameters: [{ name: 'sessionId', type: 'string' }],
        },
        {
          name: 'hashPassword',
          type: 'method',
          visibility: 'private',
          returnType: 'string',
          parameters: [{ name: 'password', type: 'string' }],
        },
      ],
    },
    {
      id: 'src.repositories.UserRepository',
      name: 'UserRepository',
      type: 'class',
      visibility: 'public',
      sourceLocation: {
        file: 'src/repositories/user-repository.ts',
        startLine: 10,
        endLine: 40,
      },
      members: [
        {
          name: 'findById',
          type: 'method',
          visibility: 'public',
          returnType: 'Promise<User | null>',
          parameters: [{ name: 'id', type: 'string' }],
        },
        {
          name: 'save',
          type: 'method',
          visibility: 'public',
          returnType: 'Promise<User>',
          parameters: [{ name: 'user', type: 'User' }],
        },
        {
          name: 'dbConnection',
          type: 'property',
          visibility: 'private',
          fieldType: 'DatabaseConnection',
        },
      ],
    },
    {
      id: 'src.repositories.SessionRepository',
      name: 'SessionRepository',
      type: 'class',
      visibility: 'public',
      sourceLocation: {
        file: 'src/repositories/session-repository.ts',
        startLine: 10,
        endLine: 35,
      },
      members: [
        {
          name: 'create',
          type: 'method',
          visibility: 'public',
          returnType: 'Promise<Session>',
          parameters: [{ name: 'userId', type: 'string' }],
        },
        {
          name: 'delete',
          type: 'method',
          visibility: 'public',
          returnType: 'Promise<void>',
          parameters: [{ name: 'sessionId', type: 'string' }],
        },
      ],
    },
    {
      id: 'src.models.User',
      name: 'User',
      type: 'interface',
      visibility: 'public',
      sourceLocation: { file: 'src/models/user.ts', startLine: 5, endLine: 12 },
      members: [
        {
          name: 'id',
          type: 'property',
          visibility: 'public',
          fieldType: 'string',
        },
        {
          name: 'email',
          type: 'property',
          visibility: 'public',
          fieldType: 'string',
        },
        {
          name: 'name',
          type: 'property',
          visibility: 'public',
          fieldType: 'string',
        },
      ],
    },
  ],
  relations: [
    {
      id: 'rel-1',
      type: 'dependency',
      source: 'src.services.UserService',
      target: 'src.repositories.UserRepository',
    },
    {
      id: 'rel-2',
      type: 'dependency',
      source: 'src.services.AuthService',
      target: 'src.repositories.UserRepository',
    },
    {
      id: 'rel-3',
      type: 'dependency',
      source: 'src.services.AuthService',
      target: 'src.repositories.SessionRepository',
    },
    {
      id: 'rel-4',
      type: 'dependency',
      source: 'src.repositories.UserRepository',
      target: 'src.models.User',
    },
  ],
};

// Initialize aggregator
const aggregator = new ArchJSONAggregator();

console.log('='.repeat(80));
console.log('ArchJSONAggregator Demo - Three-Level Detail Aggregation');
console.log('='.repeat(80));
console.log();

// Method Level (Full Detail)
console.log('1. METHOD LEVEL (Full Detail)');
console.log('-'.repeat(80));
const methodLevel = aggregator.aggregate(sampleArchJSON, 'method');
console.log(`Entities: ${methodLevel.entities.length}`);
methodLevel.entities.forEach((entity) => {
  console.log(`  - ${entity.name} (${entity.type}): ${entity.members.length} members`);
  entity.members.forEach((member) => {
    console.log(`    * ${member.name} (${member.visibility})`);
  });
});
console.log(`Relations: ${methodLevel.relations.length}`);
console.log();

// Class Level (Public Members Only)
console.log('2. CLASS LEVEL (Public Members Only)');
console.log('-'.repeat(80));
const classLevel = aggregator.aggregate(sampleArchJSON, 'class');
console.log(`Entities: ${classLevel.entities.length}`);
classLevel.entities.forEach((entity) => {
  console.log(`  - ${entity.name} (${entity.type}): ${entity.members.length} public members`);
  entity.members.forEach((member) => {
    console.log(`    * ${member.name} (${member.visibility})`);
  });
});
console.log(`Relations: ${classLevel.relations.length}`);
console.log();

// Package Level (High-Level Overview)
console.log('3. PACKAGE LEVEL (High-Level Overview)');
console.log('-'.repeat(80));
const packageLevel = aggregator.aggregate(sampleArchJSON, 'package');
console.log(`Packages: ${packageLevel.entities.length}`);
packageLevel.entities.forEach((entity) => {
  console.log(`  - ${entity.name}`);
});
console.log(`Package Relations: ${packageLevel.relations.length}`);
packageLevel.relations.forEach((relation) => {
  console.log(`  - ${relation.source} -> ${relation.target} (${relation.type})`);
});
console.log();

// Summary
console.log('='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log(`Original entities: ${sampleArchJSON.entities.length}`);
console.log(`Original relations: ${sampleArchJSON.relations.length}`);
console.log();
console.log(
  `Method level: ${methodLevel.entities.length} entities, ${methodLevel.relations.length} relations`
);
console.log(
  `Class level:  ${classLevel.entities.length} entities, ${classLevel.relations.length} relations`
);
console.log(
  `Package level: ${packageLevel.entities.length} packages, ${packageLevel.relations.length} relations`
);
console.log();
console.log('Key Feature: Automatic abstraction without losing traceability');
console.log('Use Case: Generate different diagram views for different audiences');
console.log('='.repeat(80));

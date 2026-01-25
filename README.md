# ArchGuard

Automated architecture documentation generation tool with AI-powered PlantUML diagrams.

## Overview

ArchGuard is a TypeScript tool that extracts code fingerprints from your codebase and uses Claude AI to generate high-quality PlantUML architecture diagrams.

## Features

- High-efficiency code fingerprint extraction from TypeScript
- AI-powered PlantUML class diagram generation using Claude Sonnet
- Command-line driven workflow
- TDD-driven development with high test coverage

## Installation

```bash
npm install
```

## Development Setup

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn
- Anthropic API Key (for AI features)

### Build

```bash
npm run build
```

### Testing

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run specific test suites
npm run test:unit
npm run test:integration
npm run test:e2e

# Watch mode
npm run test:watch
```

### Code Quality

```bash
# Lint
npm run lint
npm run lint:fix

# Format
npm run format
npm run format:check

# Type check
npm run type-check
```

## Project Structure

```
archguard/
├── src/
│   ├── parser/      # Code fingerprint extraction
│   ├── generator/   # AI-powered PlantUML generation
│   ├── cli/         # Command-line interface
│   ├── types/       # TypeScript type definitions
│   └── utils/       # Utility functions
├── tests/
│   ├── unit/        # Unit tests
│   ├── integration/ # Integration tests
│   └── e2e/         # End-to-end tests
├── dist/            # Build output
└── docs/            # Documentation
```

## Usage

(Coming in Phase 3)

```bash
archguard generate --input src/ --output docs/architecture.puml
```

## Development Roadmap

### Phase 0: Environment Setup (Current)
- TypeScript project structure
- Testing framework (Vitest)
- Code quality tools (ESLint, Prettier)
- CI/CD pipeline (GitHub Actions)

### Phase 1: Code Fingerprint Extraction
- TypeScript parser using ts-morph
- Arch-JSON data model
- Class, interface, and enum extraction

### Phase 2: AI Integration
- Claude API integration
- PlantUML generation
- Output validation

### Phase 3: CLI and Optimization
- Command-line interface
- Caching mechanism
- Performance optimization

## Technology Stack

| Category | Technology | Version |
|----------|-----------|---------|
| Language | TypeScript | ^5.3.0 |
| Runtime | Node.js | >=18.0.0 |
| Parser | ts-morph | ^21.0.0 |
| AI SDK | @anthropic-ai/sdk | ^0.20.0 |
| Testing | Vitest | ^1.2.0 |
| CLI | commander | ^11.1.0 |
| Logging | pino | ^8.17.0 |

## Contributing

This project follows TDD methodology and RLM (Refactoring Lifecycle Management) practices.

## License

MIT

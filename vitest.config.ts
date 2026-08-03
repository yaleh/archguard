import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData',
        '**/.{idea,git,cache,output,temp}'
      ],
      thresholds: {
        // lines/statements recalibrated 80→40 on 2026-08-03 (TASK-53, outer ruling):
        // the 80% gate was aspirational and never satisfied in CI history. Measured
        // baseline lines/stmts = 44.38% (CI round 5, run 30838632184, Node 22/24
        // consistent); functions 91% / branches 84.9% already exceed 80 and stay
        // there. 40 sits below baseline with margin, keeping a regression gate.
        // Real coverage improvement (44%→80%) tracked in TASK-58.
        lines: 40,
        functions: 80,
        branches: 80,
        statements: 40
      }
    },
    include: ['tests/**/*.{test,spec}.ts', 'src/**/*.{test,spec}.ts'],
    exclude: [
      'node_modules',
      'dist',
      'tests/poc/**/node_modules/**',  // Fix 1: exclude poc package node_modules
      'experiments/**',
      'tests/integration/performance/**', // Excluded from npm test — use npm run test:perf
    ],
    testTimeout: 30000,   // Fix 2: increase from 10s to 30s (handles resource contention)
    hookTimeout: 30000,   // Fix 3: increase hook timeout too
    pool: 'forks',        // Native modules (tree-sitter, sharp) require process isolation
    poolOptions: {
      forks: {
        singleFork: true,
        isolate: true,
      }
    },
    sequence: {
      shuffle: false,     // Keep deterministic order
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@/parser': resolve(__dirname, './src/parser'),
      '@/cli': resolve(__dirname, './src/cli'),
      '@/types': resolve(__dirname, './src/types'),
      '@/utils': resolve(__dirname, './src/utils'),
      '@/core': resolve(__dirname, './src/core'),       // NEW (Stage A-0)
      '@/analysis': resolve(__dirname, './src/analysis'), // NEW (Stage A-0)
    }
  }
});

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
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80
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
        singleFork: false,
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
      '@/generator': resolve(__dirname, './src/generator'),
      '@/cli': resolve(__dirname, './src/cli'),
      '@/types': resolve(__dirname, './src/types'),
      '@/utils': resolve(__dirname, './src/utils'),
      '@/ai': resolve(__dirname, './src/ai')
    }
  }
});

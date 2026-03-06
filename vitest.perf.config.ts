import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/performance/**/*.{test,spec}.ts'],
    testTimeout: 120000,
    hookTimeout: 30000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
        isolate: true,
      }
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

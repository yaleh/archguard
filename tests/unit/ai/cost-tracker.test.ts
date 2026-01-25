/**
 * Unit tests for CostTracker
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CostTracker } from '../../../src/ai/cost-tracker';

describe('CostTracker', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
  });

  describe('initialization', () => {
    it('should initialize with zero counts', () => {
      const report = tracker.getReport();

      expect(report.totalCalls).toBe(0);
      expect(report.totalTokens).toBe(0);
      expect(report.totalCost).toBe(0);
    });

    it('should accept custom pricing', () => {
      const customTracker = new CostTracker({
        costPerMillionInputTokens: 2.0,
        costPerMillionOutputTokens: 10.0,
      });

      expect(customTracker).toBeDefined();
    });
  });

  describe('tracking calls', () => {
    it('should track single API call', () => {
      tracker.trackCall(1000, 500);

      const report = tracker.getReport();

      expect(report.totalCalls).toBe(1);
      expect(report.totalTokens).toBe(1500);
      expect(report.totalInputTokens).toBe(1000);
      expect(report.totalOutputTokens).toBe(500);
    });

    it('should track multiple API calls', () => {
      tracker.trackCall(1000, 500);
      tracker.trackCall(2000, 1000);
      tracker.trackCall(500, 250);

      const report = tracker.getReport();

      expect(report.totalCalls).toBe(3);
      expect(report.totalTokens).toBe(5250);
      expect(report.totalInputTokens).toBe(3500);
      expect(report.totalOutputTokens).toBe(1750);
    });

    it('should handle zero tokens', () => {
      tracker.trackCall(0, 0);

      const report = tracker.getReport();

      expect(report.totalCalls).toBe(1);
      expect(report.totalTokens).toBe(0);
      expect(report.totalCost).toBe(0);
    });
  });

  describe('cost calculation', () => {
    it('should calculate cost correctly', () => {
      // Claude 3.5 Sonnet pricing: $3/M input, $15/M output
      tracker.trackCall(1000, 500);

      const report = tracker.getReport();

      // Input: 1000 tokens * $3/1M = $0.003
      // Output: 500 tokens * $15/1M = $0.0075
      // Total: $0.0105
      expect(report.totalCost).toBeCloseTo(0.0105, 6);
    });

    it('should calculate cost for large token counts', () => {
      tracker.trackCall(100000, 50000);

      const report = tracker.getReport();

      // Input: 100k * $3/1M = $0.30
      // Output: 50k * $15/1M = $0.75
      // Total: $1.05
      expect(report.totalCost).toBeCloseTo(1.05, 6);
    });

    it('should accumulate costs across multiple calls', () => {
      tracker.trackCall(1000, 500); // $0.0105
      tracker.trackCall(2000, 1000); // $0.021
      tracker.trackCall(3000, 1500); // $0.0315

      const report = tracker.getReport();

      expect(report.totalCost).toBeCloseTo(0.063, 6);
    });

    it('should use custom pricing when provided', () => {
      const customTracker = new CostTracker({
        costPerMillionInputTokens: 1.0,
        costPerMillionOutputTokens: 5.0,
      });

      customTracker.trackCall(1000, 500);

      const report = customTracker.getReport();

      // Input: 1000 * $1/1M = $0.001
      // Output: 500 * $5/1M = $0.0025
      // Total: $0.0035
      expect(report.totalCost).toBeCloseTo(0.0035, 6);
    });
  });

  describe('averages', () => {
    it('should calculate average tokens per call', () => {
      tracker.trackCall(1000, 500);
      tracker.trackCall(2000, 1000);

      const report = tracker.getReport();

      expect(report.avgTokensPerCall).toBe(2250); // (1500 + 3000) / 2
    });

    it('should calculate average cost per call', () => {
      tracker.trackCall(1000, 500); // $0.0105
      tracker.trackCall(2000, 1000); // $0.021

      const report = tracker.getReport();

      expect(report.avgCostPerCall).toBeCloseTo(0.01575, 6); // (0.0105 + 0.021) / 2
    });

    it('should handle division by zero for averages', () => {
      const report = tracker.getReport();

      expect(report.avgTokensPerCall).toBe(0);
      expect(report.avgCostPerCall).toBe(0);
    });
  });

  describe('budget management', () => {
    it('should track budget when set', () => {
      tracker.setBudget(0.1); // $0.10 budget

      tracker.trackCall(10000, 5000); // ~$0.105

      expect(tracker.isOverBudget()).toBe(true);
      expect(tracker.getRemainingBudget()).toBeLessThan(0);
    });

    it('should not be over budget when within limits', () => {
      tracker.setBudget(1.0);

      tracker.trackCall(10000, 5000); // ~$0.105

      expect(tracker.isOverBudget()).toBe(false);
      expect(tracker.getRemainingBudget()).toBeGreaterThan(0);
    });

    it('should calculate remaining budget correctly', () => {
      tracker.setBudget(0.5);

      tracker.trackCall(50000, 25000); // ~$0.525

      const remaining = tracker.getRemainingBudget();
      expect(remaining).toBeCloseTo(-0.025, 6);
    });

    it('should return Infinity when no budget is set', () => {
      tracker.trackCall(10000, 5000);

      expect(tracker.isOverBudget()).toBe(false);
      expect(tracker.getRemainingBudget()).toBe(Infinity);
    });
  });

  describe('reset', () => {
    it('should reset all counters', () => {
      tracker.trackCall(1000, 500);
      tracker.trackCall(2000, 1000);

      tracker.reset();

      const report = tracker.getReport();

      expect(report.totalCalls).toBe(0);
      expect(report.totalTokens).toBe(0);
      expect(report.totalCost).toBe(0);
    });

    it('should preserve budget after reset', () => {
      tracker.setBudget(1.0);
      tracker.trackCall(1000, 500);

      tracker.reset();

      expect(tracker.isOverBudget()).toBe(false);
      expect(tracker.getRemainingBudget()).toBe(1.0);
    });
  });

  describe('report formatting', () => {
    it('should provide detailed report', () => {
      tracker.trackCall(5000, 2500);
      tracker.trackCall(3000, 1500);

      const report = tracker.getReport();

      expect(report).toHaveProperty('totalCalls');
      expect(report).toHaveProperty('totalTokens');
      expect(report).toHaveProperty('totalInputTokens');
      expect(report).toHaveProperty('totalOutputTokens');
      expect(report).toHaveProperty('totalCost');
      expect(report).toHaveProperty('avgTokensPerCall');
      expect(report).toHaveProperty('avgCostPerCall');
    });

    it('should format cost in dollars', () => {
      tracker.trackCall(100000, 50000);

      const formatted = tracker.getFormattedCost();

      expect(formatted).toContain('$');
      expect(formatted).toContain('1.05');
    });
  });

  describe('edge cases', () => {
    it('should handle very large token counts', () => {
      tracker.trackCall(1000000, 500000);

      const report = tracker.getReport();

      expect(report.totalTokens).toBe(1500000);
      expect(report.totalCost).toBeCloseTo(10.5, 2); // $3 + $7.5
    });

    it('should handle fractional cents', () => {
      tracker.trackCall(10, 5);

      const report = tracker.getReport();

      expect(report.totalCost).toBeGreaterThan(0);
      expect(report.totalCost).toBeLessThan(0.001);
    });
  });
});

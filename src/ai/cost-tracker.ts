/**
 * Cost Tracker
 * Tracks API usage and costs for Claude API calls
 */

/**
 * Cost tracker configuration
 */
export interface CostTrackerConfig {
  costPerMillionInputTokens?: number;
  costPerMillionOutputTokens?: number;
}

/**
 * Cost report structure
 */
export interface CostReport {
  totalCalls: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  avgTokensPerCall: number;
  avgCostPerCall: number;
}

/**
 * CostTracker - tracks and reports API usage costs
 */
export class CostTracker {
  private totalCalls = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCost = 0;
  private budget?: number;

  // Claude 3.5 Sonnet pricing (2026-01-25)
  private readonly COST_PER_MILLION_INPUT: number;
  private readonly COST_PER_MILLION_OUTPUT: number;

  constructor(config: CostTrackerConfig = {}) {
    this.COST_PER_MILLION_INPUT = config.costPerMillionInputTokens || 3.0;
    this.COST_PER_MILLION_OUTPUT = config.costPerMillionOutputTokens || 15.0;
  }

  /**
   * Track a single API call
   */
  trackCall(inputTokens: number, outputTokens: number): void {
    this.totalCalls++;
    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;

    // Calculate cost for this call
    const inputCost = (inputTokens / 1_000_000) * this.COST_PER_MILLION_INPUT;
    const outputCost = (outputTokens / 1_000_000) * this.COST_PER_MILLION_OUTPUT;

    this.totalCost += inputCost + outputCost;
  }

  /**
   * Get comprehensive cost report
   */
  getReport(): CostReport {
    return {
      totalCalls: this.totalCalls,
      totalTokens: this.totalInputTokens + this.totalOutputTokens,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalCost: this.totalCost,
      avgTokensPerCall:
        this.totalCalls > 0
          ? (this.totalInputTokens + this.totalOutputTokens) / this.totalCalls
          : 0,
      avgCostPerCall: this.totalCalls > 0 ? this.totalCost / this.totalCalls : 0,
    };
  }

  /**
   * Get formatted cost string
   */
  getFormattedCost(): string {
    return `$${this.totalCost.toFixed(4)}`;
  }

  /**
   * Set budget limit
   */
  setBudget(amount: number): void {
    this.budget = amount;
  }

  /**
   * Check if over budget
   */
  isOverBudget(): boolean {
    if (this.budget === undefined) {
      return false;
    }
    return this.totalCost > this.budget;
  }

  /**
   * Get remaining budget
   */
  getRemainingBudget(): number {
    if (this.budget === undefined) {
      return Infinity;
    }
    return this.budget - this.totalCost;
  }

  /**
   * Reset all counters (preserves budget)
   */
  reset(): void {
    this.totalCalls = 0;
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.totalCost = 0;
  }
}

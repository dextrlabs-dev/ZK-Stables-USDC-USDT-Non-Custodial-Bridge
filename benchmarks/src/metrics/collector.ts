import type { JobTimeline, PhaseDurations, ScenarioResult, GasMeasurement, CardanoCost, ThroughputMetrics } from '../types.js';

export class MetricsCollector {
  readonly timelines: JobTimeline[] = [];
  readonly gasMeasurements: GasMeasurement[] = [];
  readonly cardanoCosts: CardanoCost[] = [];
  readonly errors: string[] = [];
  private startedAt = Date.now();

  start() {
    this.startedAt = Date.now();
  }

  addTimeline(tl: JobTimeline) {
    this.timelines.push(tl);
  }

  addGas(m: GasMeasurement) {
    this.gasMeasurements.push(m);
  }

  addCardanoCost(c: CardanoCost) {
    this.cardanoCosts.push(c);
  }

  addError(msg: string) {
    this.errors.push(msg);
  }

  toResult(name: string, throughput?: ThroughputMetrics): ScenarioResult {
    return {
      name,
      startedAt: new Date(this.startedAt).toISOString(),
      durationMs: Date.now() - this.startedAt,
      timelines: this.timelines,
      gasMeasurements: this.gasMeasurements,
      cardanoCosts: this.cardanoCosts,
      throughput,
      errors: this.errors,
    };
  }
}

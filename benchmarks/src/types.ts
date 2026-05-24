export type RelayerPhase =
  | 'received'
  | 'awaiting_finality'
  | 'proving'
  | 'destination_handoff'
  | 'completed'
  | 'failed';

export type PhaseObservation = {
  jobId: string;
  phase: RelayerPhase;
  observedAt: number;
};

export type JobTimeline = {
  jobId: string;
  createdAt: number;
  observations: PhaseObservation[];
  finalPhase: 'completed' | 'failed';
  phaseDurations: PhaseDurations;
  totalMs: number;
};

export type PhaseDurations = {
  receivedMs?: number;
  awaitingFinalityMs?: number;
  provingMs?: number;
  destinationHandoffMs?: number;
};

export type GasMeasurement = {
  operation: string;
  txHash: string;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  gasCostWei: bigint;
};

export type CardanoCost = {
  operation: string;
  txHash: string;
  memoryUnits: number;
  cpuSteps: number;
};

export type LatencyBudgetRow = {
  route: string;
  phase: string;
  expectedRange: string;
  actualP50Ms: number;
  actualP90Ms: number;
  withinBudget: boolean;
};

export type ScenarioResult = {
  name: string;
  startedAt: string;
  durationMs: number;
  timelines: JobTimeline[];
  gasMeasurements: GasMeasurement[];
  cardanoCosts: CardanoCost[];
  throughput?: ThroughputMetrics;
  errors: string[];
};

export type ThroughputMetrics = {
  totalSubmitted: number;
  totalCompleted: number;
  totalFailed: number;
  submissionRps: number;
  completionRps: number;
  peakConcurrentInFlight: number;
};

export type BenchmarkReport = {
  generatedAt: string;
  environment: {
    relayerUrl: string;
    evmRpcUrl: string;
    yaciUrl: string;
    concurrency: number;
    pollMs: number;
  };
  scenarios: ScenarioResult[];
};

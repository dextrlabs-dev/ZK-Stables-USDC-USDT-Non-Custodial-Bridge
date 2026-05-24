export const config = {
  relayerUrl:    process.env.BENCH_RELAYER_URL    || 'http://127.0.0.1:8787',
  evmRpcUrl:     process.env.BENCH_EVM_RPC_URL    || 'http://127.0.0.1:8545',
  yaciUrl:       process.env.BENCH_YACI_URL       || '',
  concurrency:   parseInt(process.env.BENCH_CONCURRENCY || '5', 10),
  totalIntents:  parseInt(process.env.BENCH_TOTAL_INTENTS || '20', 10),
  pollMs:        parseInt(process.env.BENCH_POLL_MS || '200', 10),
  jobTimeoutMs:  parseInt(process.env.BENCH_JOB_TIMEOUT_MS || '300000', 10),
  addrsJson:     process.env.BENCH_DEPLOY_ADDRS_JSON || '/tmp/zk-stables-anvil-addrs.json',
  skipDeploy:    process.env.BENCH_SKIP_DEPLOY === 'true',
  reportPath:    process.env.BENCH_REPORT_PATH    || 'docs/BENCHMARK_REPORT.md',
  reportJson:    process.env.BENCH_REPORT_JSON    || '/tmp/zk-stables-benchmark.json',
} as const;

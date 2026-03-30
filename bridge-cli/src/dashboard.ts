import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import readline from 'node:readline';
import { parseArgsStringToArgv } from 'string-argv';
import type { BridgeCliEnv } from './config.js';
import { buildBalanceSnapshot, dashboardConfigFromEnv, type DashboardBalanceSnapshot } from './balances/snapshot.js';

function cliEntryPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'cli.js');
}

function render(s: DashboardBalanceSnapshot) {
  console.clear();
  const rel = s.relayer?.ok ? 'ok' : `down (${s.relayer?.detail ?? '?'})`;
  process.stdout.write(
    [
      '══════════════════════════════════════════════════════════════════════════════',
      `  ZK-Stables bridge dashboard   ${s.updatedAt}   relayer: ${rel}`,
      '══════════════════════════════════════════════════════════════════════════════',
      '',
      `  EVM ${s.evm.address}`,
      `    mUSDC (underlying)  ${s.evm.error ? `error: ${s.evm.error}` : s.evm.usdc.padStart(24, ' ')}`,
      `    mUSDT (underlying)  ${s.evm.error ? '—'.padStart(24, ' ') : s.evm.usdt.padStart(24, ' ')}`,
      '',
      `  Cardano ${s.cardano.address}   [${s.cardano.indexer}]`,
      `    zkUSDC (native)     ${s.cardano.error ? `error: ${s.cardano.error}` : s.cardano.zkUsdc.padStart(24, ' ')}`,
      `    zkUSDT (native)     ${s.cardano.error ? '—'.padStart(24, ' ') : s.cardano.zkUsdt.padStart(24, ' ')}`,
      ...(s.notes?.cardanoZkVsEvmWrapped
        ? [
            '',
            '  Cardano vs EVM:',
            `    ${s.notes.cardanoZkVsEvmWrapped.replaceAll('**', '')}`,
          ]
        : []),
      '',
      `  Midnight   [${s.midnight.syncNote}]`,
      s.midnight.unshieldedPreview ? `    unshielded ${s.midnight.unshieldedPreview}` : '',
      `    zkUSDC (unshielded) ${s.midnight.error ? `error: ${s.midnight.error}` : s.midnight.zkUsdc.padStart(24, ' ')}`,
      `    zkUSDT (unshielded) ${s.midnight.error ? '—'.padStart(24, ' ') : s.midnight.zkUsdt.padStart(24, ' ')}`,
      s.midnight.rawTypesHelp ? `    ${s.midnight.rawTypesHelp}` : '',
      '',
      '  ────────────────────────────────────────────────────────────────────────────',
      '  Keys: [r] refresh now   [m] run CLI command (mint / redeem / job / info …)   [q] quit',
      '══════════════════════════════════════════════════════════════════════════════',
      '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

function runCliCommand(line: string): Promise<number> {
  const trimmed = line.trim();
  if (!trimmed) return Promise.resolve(0);
  let parts = parseArgsStringToArgv(trimmed);
  if (parts[0] === 'zk-bridge') parts = parts.slice(1);
  const argv = [cliEntryPath(), ...parts];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, argv, { stdio: 'inherit', env: process.env });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (e) => {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
      resolve(1);
    });
  });
}

export async function runDashboard(opts: { env: BridgeCliEnv; intervalMs: number }): Promise<void> {
  const dash = dashboardConfigFromEnv(opts.env);
  let busy = false;

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const latest = await buildBalanceSnapshot(opts.env, dash);
      render(latest);
    } catch (e) {
      console.clear();
      process.stdout.write(`Dashboard tick failed: ${e instanceof Error ? e.message : String(e)}\n`);
    } finally {
      busy = false;
    }
  };

  const st = { timer: null as ReturnType<typeof setInterval> | null };

  const startTimer = () => {
    if (st.timer) clearInterval(st.timer);
    st.timer = setInterval(() => {
      void tick();
    }, Math.max(500, opts.intervalMs));
  };

  const stopTimer = () => {
    if (st.timer) clearInterval(st.timer);
    st.timer = null;
  };

  await tick();
  startTimer();

  const shutdown = () => {
    stopTimer();
    try {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
    } catch {
      /* ignore */
    }
    process.stdin.removeAllListeners('keypress');
  };

  if (!process.stdin.isTTY) {
    process.stdout.write('stdin is not a TTY — auto-refresh only. Press Ctrl+C to exit.\n');
    await new Promise<void>((r) => process.once('SIGINT', () => r()));
    shutdown();
    return;
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  process.stdin.on('keypress', async (_str, key) => {
    if (!key) return;
    if (key.ctrl && key.name === 'c') {
      shutdown();
      process.exit(0);
    }
    if (key.name === 'q') {
      shutdown();
      process.exit(0);
    }
    if (key.name === 'r') {
      await tick();
      return;
    }
    if (key.name === 'm') {
      stopTimer();
      try {
        process.stdin.setRawMode(false);
      } catch {
        /* ignore */
      }
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const prompt =
        'Enter zk-bridge args (e.g. mint --destination midnight --asset USDC --amount 1 --recipient mn_addr…): ';
      const answer = await new Promise<string>((resolve) => {
        rl.question(prompt, resolve);
      });
      rl.close();
      try {
        process.stdin.setRawMode(true);
      } catch {
        /* ignore */
      }
      const code = await runCliCommand(answer);
      process.stdout.write(`\n(exit ${code})\n`);
      startTimer();
      await tick();
    }
  });

  await new Promise<void>((resolve) => {
    process.once('SIGINT', () => resolve());
  });
  shutdown();
}

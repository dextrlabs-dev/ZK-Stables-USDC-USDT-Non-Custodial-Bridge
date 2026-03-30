import { filter, firstValueFrom, take, timeout } from 'rxjs';
import type { WalletContext } from './walletBootstrap.js';

const SYNC_MS = Number.parseInt(process.env.BRIDGE_CLI_MIDNIGHT_SYNC_TIMEOUT_MS ?? '120000', 10);

export async function waitSyncedUnshieldedBalances(ctx: WalletContext): Promise<Record<string, bigint>> {
  const s = await firstValueFrom(
    ctx.wallet.state().pipe(
      filter((st: { isSynced?: boolean }) => Boolean(st.isSynced)),
      take(1),
      timeout(SYNC_MS),
    ),
  );
  const bals = (s as { unshielded?: { balances?: Record<string, bigint> } }).unshielded?.balances ?? {};
  return bals;
}

/** Latest snapshot (fast path once the wallet has synced at least once). */
export async function readLatestUnshieldedBalances(ctx: WalletContext): Promise<Record<string, bigint>> {
  const s = await firstValueFrom(ctx.wallet.state().pipe(take(1)));
  if ((s as { isSynced?: boolean }).isSynced) {
    return (s as { unshielded?: { balances?: Record<string, bigint> } }).unshielded?.balances ?? {};
  }
  return waitSyncedUnshieldedBalances(ctx);
}

export function formatTokenAmount(raw: bigint, decimals: number): string {
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const d = BigInt(10) ** BigInt(decimals);
  const whole = v / d;
  const frac = v % d;
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/u, '');
  const s = fracStr.length > 0 ? `${whole.toString()}.${fracStr}` : whole.toString();
  return neg ? `-${s}` : s;
}

export function pickBalance(balances: Record<string, bigint>, rawType: string | undefined): bigint {
  const k = (rawType ?? '').trim();
  if (!k) return 0n;
  if (balances[k] !== undefined) return balances[k]!;
  const kl = k.toLowerCase();
  for (const [key, val] of Object.entries(balances)) {
    if (key.toLowerCase() === kl) return val;
  }
  return 0n;
}

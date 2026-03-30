/** Matches `Invalid Transaction: Custom error: 196` from Hon / Midnight node. */
const CUSTOM_ERR_RE = /Custom error:\s*(\d+)/i;

export type MidnightTxHintContext = 'initiateBurn' | 'proveHolder' | 'mintWrappedUnshielded' | 'generic';

/**
 * Append short, action-oriented hints after a raw wallet / SDK submission error string.
 * Node "custom error" codes are not stable across versions; we key most guidance on `context`.
 */
export function formatMidnightTxFailureForUser(serialized: string, context: MidnightTxHintContext): string {
  const trimmed = serialized.length > 12_000 ? `${serialized.slice(0, 12_000)}\n…(truncated)` : serialized;
  const m = trimmed.match(CUSTOM_ERR_RE);
  const code = m ? parseInt(m[1], 10) : undefined;
  const hints: string[] = [];

  if (code === 138) {
    hints.push(
      'Code 138: on local Midnight this often means dust / fee margins are too tight for a heavier circuit. The in-app dev-seed wallet raises `costParameters` for that reason; Lace may still hit 138 for large proofs — retry or use a wallet/stack aligned with midnight-local-network fee settings.',
    );
  }

  if (context === 'initiateBurn') {
    if (code === 196 || /Invalid Transaction/i.test(trimmed)) {
      hints.push(
        'initiateBurn was rejected at submission. If proving succeeded, the registry contract or node still declined the transaction. Most often:',
        '• Wrong contract: "Join" address must be the same registry instance that recorded this deposit (match relayer `RELAYER_MIDNIGHT_CONTRACT_ADDRESS` and the indexer you use).',
        '• Wrong signer / private state: use the same Midnight connection (and holder keys) that ran proveHolder + mint for this deposit; joining with default demo keys while the deposit was created under another wallet fails holder checks.',
        '• Wrong deposit key or status: deposit bytes must match the ledger row exactly; status must still be Active (not ExitPending / Burned).',
      );
    }
  }

  if (context === 'proveHolder' && code === 138) {
    hints.push('proveHolder: see code 138 note above (fee / dust margin).');
  }

  if (hints.length === 0 && /Invalid Transaction/i.test(trimmed)) {
    hints.push(
      'Invalid transaction at the node: confirm undeployed network id, indexer URL, and that the wallet has funds for fees.',
    );
  }

  if (hints.length === 0) return trimmed;
  return `${trimmed}\n\n── Hint ──\n${hints.map((h) => (h.startsWith('•') ? h : `• ${h}`)).join('\n')}`;
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchJobs, type JobApiRow } from '../api/relayerClient';

const PHASE_STEPS = ['Queued', 'Finality', 'Proving', 'Handoff', 'Done'] as const;

function phaseBadgeClass(phase: string): string {
  if (phase === 'completed') return 'ex-badge ex-badge--ok';
  if (phase === 'failed') return 'ex-badge ex-badge--fail';
  return 'ex-badge ex-badge--active';
}

function routeInvolvesMidnight(intent: JobApiRow['intent']): boolean {
  return intent.sourceChain === 'midnight' || intent.destinationChain === 'midnight';
}

function truncHash(h: string | undefined | null, len = 10): string {
  if (!h) return '—';
  const s = h.replace(/^0x/i, '');
  if (s.length <= len * 2) return h;
  return `${h.slice(0, h.startsWith('0x') ? len + 2 : len)}…${s.slice(-len)}`;
}

function TxLink({ label, hash, explorer }: { label: string; hash?: string | null; explorer?: string }) {
  if (!hash) return null;
  const url = explorer ? `${explorer}/${hash}` : undefined;
  return (
    <div className="ex-tx-row">
      <span className="ex-tx-label">{label}</span>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="ex-tx-hash mono" title={hash}>
          {truncHash(hash)}
        </a>
      ) : (
        <span className="ex-tx-hash mono" title={hash}>{truncHash(hash)}</span>
      )}
    </div>
  );
}

function KV({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) {
  if (value == null || value === '') return null;
  return (
    <div className="ex-kv">
      <span className="ex-kv-label">{label}</span>
      <span className={`ex-kv-value ${mono ? 'mono' : ''}`} title={String(value)}>{String(value)}</span>
    </div>
  );
}

function SourceDetails({ job }: { job: JobApiRow }) {
  const src = job.intent.source;
  if (!src) return null;

  const evm = src.evm;
  const cardano = src.cardano;
  const midnight = src.midnight;

  return (
    <div className="ex-source-details">
      {evm && (
        <div className="ex-source-chain">
          <span className="ex-source-chain-tag">EVM</span>
          <TxLink label="Tx" hash={evm.txHash} />
          <KV label="Log Index" value={evm.logIndex} mono />
          <KV label="Block" value={evm.blockNumber} mono />
          <KV label="Pool" value={evm.poolLockAddress ? truncHash(evm.poolLockAddress, 8) : undefined} mono />
          <KV label="Token" value={evm.token ? truncHash(evm.token, 8) : undefined} mono />
          <KV label="Wrapped" value={evm.wrappedTokenAddress ? truncHash(evm.wrappedTokenAddress, 8) : undefined} mono />
          <KV label="Nonce" value={evm.nonce ? truncHash(evm.nonce, 8) : undefined} mono />
          <KV label="From" value={evm.fromAddress ? truncHash(evm.fromAddress, 8) : undefined} mono />
        </div>
      )}
      {cardano && (
        <div className="ex-source-chain">
          <span className="ex-source-chain-tag">Cardano</span>
          <TxLink label="Tx" hash={cardano.txHash} />
          <KV label="Output" value={cardano.outputIndex} mono />
          <TxLink label="Spend Tx" hash={cardano.spendTxHash} />
          <KV label="Policy" value={cardano.policyIdHex ? truncHash(cardano.policyIdHex, 8) : undefined} mono />
          <KV label="Lock Nonce" value={cardano.lockNonce} mono />
        </div>
      )}
      {midnight && (
        <div className="ex-source-chain">
          <span className="ex-source-chain-tag">Midnight</span>
          <TxLink label="Tx ID" hash={midnight.txId} />
          <TxLink label="Tx Hash" hash={midnight.txHash} />
          <KV label="Contract" value={midnight.contractAddress ? truncHash(midnight.contractAddress, 8) : undefined} mono />
          <KV label="Deposit" value={midnight.depositCommitmentHex ? truncHash(midnight.depositCommitmentHex, 8) : undefined} mono />
          <KV label="Dest Chain" value={midnight.destChainId} />
        </div>
      )}
    </div>
  );
}

function MiniProgressBar({ job }: { job: JobApiRow }) {
  const idx = job.ui.phaseIndex;
  const failed = job.phase === 'failed';
  const pct = failed ? 100 : Math.round(((idx + 1) / job.ui.phaseCount) * 100);

  return (
    <div className="ex-bar-wrap">
      <div
        className={`ex-bar-fill ${failed ? 'ex-bar--fail' : job.phase === 'completed' ? 'ex-bar--done' : ''}`}
        style={{ width: `${pct}%` }}
      />
      <div className="ex-bar-steps">
        {PHASE_STEPS.map((s, i) => (
          <span key={s} className={`ex-bar-step ${i <= idx && !failed ? 'ex-bar-step--active' : ''} ${failed ? 'ex-bar-step--fail' : ''}`}>
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

function JobDetail({ job, onBack }: { job: JobApiRow; onBack: () => void }) {
  const intent = job.intent;
  const arrow = intent.sourceChain && intent.destinationChain
    ? `${intent.sourceChain} → ${intent.destinationChain}`
    : '';

  return (
    <div className="ex-detail">
      <button className="ex-back" onClick={onBack} type="button">← Back to list</button>

      <div className="ex-detail-header">
        <span className={phaseBadgeClass(job.phase)}>{job.ui.phaseLabel}</span>
        <span className="ex-detail-op">{intent.operation}</span>
        <span className="ex-detail-route">{arrow}</span>
        <span className="ex-detail-asset">{intent.asset} {intent.amount}</span>
      </div>

      <MiniProgressBar job={job} />

      {job.error && <div className="ex-detail-error">{job.error}</div>}

      <div className="ex-detail-grid">
        <div className="ex-detail-section">
          <h4 className="ex-detail-section-title">Job Info</h4>
          <KV label="Job ID" value={job.id} mono />
          <KV label="Created" value={job.createdAt ? new Date(job.createdAt).toLocaleString() : undefined} />
          <KV label="Updated" value={job.updatedAt ? new Date(job.updatedAt).toLocaleString() : undefined} />
          <KV label="Lock Ref" value={job.lockRef} mono />
        </div>

        <div className="ex-detail-section">
          <h4 className="ex-detail-section-title">Intent</h4>
          <KV label="Operation" value={intent.operation} />
          <KV label="Source" value={intent.sourceChain} />
          <KV label="Destination" value={intent.destinationChain} />
          <KV label="Asset" value={intent.asset} />
          <KV label="Amount" value={intent.amount} />
          <KV label="Recipient" value={intent.recipient ? truncHash(intent.recipient, 12) : undefined} mono />
          {intent.note && <KV label="Note" value={intent.note} />}
        </div>

        <div className="ex-detail-section">
          <h4 className="ex-detail-section-title">Commitments</h4>
          <KV label="Burn Commitment" value={intent.burnCommitmentHex ? truncHash(intent.burnCommitmentHex, 12) : undefined} mono />
          <KV label="Deposit Commitment" value={job.depositCommitmentHex ? truncHash(job.depositCommitmentHex, 12) : undefined} mono />
          {routeInvolvesMidnight(intent) && intent.operation === 'LOCK' ? (
            <p className="ex-detail-note">
              LOCK / mint jobs do not use burn or deposit commitment fields. The binding is the source lock (for example EVM pool nonce in Source Chain Data).
            </p>
          ) : routeInvolvesMidnight(intent) && intent.operation === 'BURN' && !job.depositCommitmentHex ? (
            <p className="ex-detail-note">
              Deposit commitment is computed when the job reaches destination handoff (after proving). If burn commitment is also missing, this job predates that field or used a path that omits it.
            </p>
          ) : routeInvolvesMidnight(intent) && !intent.burnCommitmentHex && !job.depositCommitmentHex ? (
            <p className="ex-detail-note">No commitment fields on this job record.</p>
          ) : null}
        </div>

        {job.proofBundle && (
          <div className="ex-detail-section">
            <h4 className="ex-detail-section-title">Proof</h4>
            <KV label="Digest" value={job.proofBundle.digest ? truncHash(job.proofBundle.digest, 12) : undefined} mono />
          </div>
        )}

        <div className="ex-detail-section ex-detail-section--wide">
          <h4 className="ex-detail-section-title">Source Chain Data</h4>
          <SourceDetails job={job} />
        </div>
      </div>
    </div>
  );
}

function JobRow({ job, onSelect }: { job: JobApiRow; onSelect: () => void }) {
  const intent = job.intent;
  const arrow = intent.sourceChain && intent.destinationChain
    ? `${intent.sourceChain} → ${intent.destinationChain}`
    : '';

  const sourceTx =
    intent.source?.evm?.txHash ??
    intent.source?.cardano?.txHash ??
    intent.source?.midnight?.txId ??
    intent.source?.midnight?.txHash;

  return (
    <button className="ex-row" onClick={onSelect} type="button">
      <div className="ex-row-left">
        <span className={phaseBadgeClass(job.phase)}>{job.ui.phaseLabel}</span>
        <span className="ex-row-op">{intent.operation}</span>
        <span className="ex-row-route">{arrow}</span>
      </div>
      <div className="ex-row-center">
        <span className="ex-row-asset">{intent.asset} {intent.amount}</span>
        {sourceTx && <span className="ex-row-tx mono" title={sourceTx}>{truncHash(sourceTx, 6)}</span>}
      </div>
      <div className="ex-row-right">
        <span className="ex-row-time">{new Date(job.createdAt).toLocaleString()}</span>
      </div>
    </button>
  );
}

export function Explorer({ onBack }: { onBack: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'LOCK' | 'BURN'>('all');
  const [chainFilter, setChainFilter] = useState<string>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['explorer-jobs'],
    queryFn: fetchJobs,
    refetchInterval: 5_000,
  });

  const jobs = data?.jobs ?? [];

  const filtered = jobs.filter((j) => {
    if (filter !== 'all' && j.intent.operation !== filter) return false;
    if (chainFilter !== 'all') {
      if (j.intent.sourceChain !== chainFilter && j.intent.destinationChain !== chainFilter) return false;
    }
    return true;
  });

  const chains = Array.from(new Set(
    jobs.flatMap((j) => [j.intent.sourceChain, j.intent.destinationChain].filter(Boolean) as string[]),
  )).sort();

  const selectedJob = selectedId ? jobs.find((j) => j.id === selectedId) : null;

  if (selectedJob) {
    return (
      <section className="ex-section" aria-label="Job detail">
        <div className="ex-header">
          <h2 className="ex-title">Explorer</h2>
          <button className="ex-nav-back" onClick={onBack} type="button">← Console</button>
        </div>
        <JobDetail job={selectedJob} onBack={() => setSelectedId(null)} />
      </section>
    );
  }

  return (
    <section className="ex-section" aria-label="Operations explorer">
      <div className="ex-header">
        <h2 className="ex-title">Explorer</h2>
        <button className="ex-nav-back" onClick={onBack} type="button">← Console</button>
      </div>

      <div className="ex-toolbar">
        <div className="ex-filter-group">
          {(['all', 'LOCK', 'BURN'] as const).map((f) => (
            <button
              key={f}
              className={`ex-filter-btn ${filter === f ? 'ex-filter-btn--active' : ''}`}
              onClick={() => setFilter(f)}
              type="button"
            >
              {f === 'all' ? 'All' : f}
            </button>
          ))}
        </div>
        <div className="ex-filter-group">
          <button
            className={`ex-filter-btn ${chainFilter === 'all' ? 'ex-filter-btn--active' : ''}`}
            onClick={() => setChainFilter('all')}
            type="button"
          >
            All chains
          </button>
          {chains.map((c) => (
            <button
              key={c}
              className={`ex-filter-btn ${chainFilter === c ? 'ex-filter-btn--active' : ''}`}
              onClick={() => setChainFilter(c)}
              type="button"
            >
              {c}
            </button>
          ))}
        </div>
        <span className="ex-count">{filtered.length} operation{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {isLoading ? (
        <div className="ex-loading">Loading operations…</div>
      ) : filtered.length === 0 ? (
        <div className="ex-empty">No operations found</div>
      ) : (
        <div className="ex-list">
          {filtered.map((j) => (
            <JobRow key={j.id} job={j} onSelect={() => setSelectedId(j.id)} />
          ))}
        </div>
      )}
    </section>
  );
}

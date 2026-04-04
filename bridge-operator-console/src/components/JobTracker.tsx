import { useQuery } from '@tanstack/react-query';
import { fetchJobs, type JobApiRow } from '../api/relayerClient';

const PHASE_STEPS = ['Queued', 'Finality', 'Proving', 'Handoff', 'Done'];

function ProgressBar({ job }: { job: JobApiRow }) {
  const idx = job.ui.phaseIndex;
  const failed = job.phase === 'failed';
  const pct = failed ? 100 : Math.round(((idx + 1) / job.ui.phaseCount) * 100);

  const arrow = job.intent.sourceChain && job.intent.destinationChain
    ? `${job.intent.sourceChain} → ${job.intent.destinationChain}`
    : '';

  return (
    <div className="jt-row">
      <div className="jt-meta">
        <span className="jt-op">{job.intent.operation}</span>
        <span className="jt-route">{arrow}</span>
        <span className="jt-asset">{job.intent.asset} {job.intent.amount}</span>
      </div>
      <div className="jt-bar-wrap">
        <div
          className={`jt-bar-fill ${failed ? 'jt-bar--fail' : job.phase === 'completed' ? 'jt-bar--done' : ''}`}
          style={{ width: `${pct}%` }}
        />
        <div className="jt-bar-steps">
          {PHASE_STEPS.map((s, i) => (
            <span
              key={s}
              className={`jt-step ${i <= idx && !failed ? 'jt-step--active' : ''} ${failed ? 'jt-step--fail' : ''}`}
            >
              {s}
            </span>
          ))}
        </div>
      </div>
      <div className="jt-label">
        {failed ? <span className="jt-fail-text">{job.error?.slice(0, 80) || 'Failed'}</span> : job.ui.phaseLabel}
      </div>
    </div>
  );
}

export function JobTracker() {
  const { data, isLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: fetchJobs,
    refetchInterval: 3_000,
  });

  const jobs = data?.jobs ?? [];
  const active = jobs.filter((j) => j.phase !== 'completed' && j.phase !== 'failed');
  const recent = jobs.filter((j) => j.phase === 'completed' || j.phase === 'failed').slice(0, 5);
  const display = [...active, ...recent];

  if (isLoading) return <div className="jt-loading">Loading jobs…</div>;
  if (display.length === 0) return <div className="jt-empty">No jobs yet</div>;

  return (
    <section className="jt-section" aria-label="Job progress">
      <h2 className="jt-title">Jobs</h2>
      <div className="jt-list">
        {display.map((j) => (
          <ProgressBar key={j.id} job={j} />
        ))}
      </div>
    </section>
  );
}

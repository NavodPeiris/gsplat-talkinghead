import { useEffect, useState } from 'react';
import type { SessionStatus } from '../types';

const LABELS: Record<SessionStatus, string> = {
  DISCONNECTED: 'Ready',
  CONNECTING: 'Connecting',
  CONNECTED: 'Live',
};

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Overlay chip in the avatar window: session state plus call duration while live. */
export function StatusBadge({ status }: { status: SessionStatus }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (status !== 'CONNECTED') return;
    const startedAt = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [status]);

  return (
    <div className="aa-badge" data-status={status} role="status" aria-live="polite">
      <span className="aa-dot" aria-hidden="true" />
      {LABELS[status]}
      {status === 'CONNECTED' && (
        <span className="aa-badge-time" aria-hidden="true">
          {formatElapsed(elapsed)}
        </span>
      )}
    </div>
  );
}

/** Covers the avatar window while the avatar bundle and lipsync model download. */
export function AssetsLoader({ progress }: { progress: number | null }) {
  const pct = progress === null ? null : Math.round(progress * 100);
  return (
    <div className="aa-loader" role="status" aria-live="polite">
      <span className="aa-loader-spinner" aria-hidden="true" />
      <span className="aa-loader-label">Downloading assets{pct === null ? '…' : ` ${pct}%`}</span>
      {pct !== null && (
        <div className="aa-loader-bar" aria-hidden="true">
          <div className="aa-loader-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

// Branded Veyra loading state — a tokenized skeleton/spinner with a label.
// Reduced-motion users get a static ring (handled in globals.css).

export interface LoaderProps {
  label?: string;
}

export function Loader({ label }: LoaderProps) {
  return (
    <div className="v-loader" role="status" aria-live="polite">
      <span className="v-loader-ring" aria-hidden="true">
        <span className="v-loader-core">V</span>
      </span>
      {label && <span className="v-mono v-loader-label">{label}</span>}
    </div>
  );
}

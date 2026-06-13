/** The Agent Times spark — a little asterisk/burst, the ember of the morning paper. */
export function Spark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <line x1="12" y1="2" x2="12" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="4.9" y1="4.9" x2="19.1" y2="19.1" />
      <line x1="19.1" y1="4.9" x2="4.9" y2="19.1" />
      <line x1="12" y1="5.5" x2="12" y2="18.5" opacity="0.55" transform="rotate(30 12 12)" />
      <line x1="12" y1="5.5" x2="12" y2="18.5" opacity="0.55" transform="rotate(-30 12 12)" />
    </svg>
  );
}

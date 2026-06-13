/**
 * The Agent Times nameplate — NYT-style blackletter wordmark.
 * `flanked` adds the thin dateline rules on either side of the name,
 * the way a real front-page masthead frames it. Defaults on.
 */
export function Masthead({
  className = "",
  flanked = true,
  size = "text-5xl sm:text-6xl",
}: {
  className?: string;
  flanked?: boolean;
  size?: string;
}) {
  const name = (
    <span
      className={`font-blackletter leading-none tracking-tight ${size}`}
      style={{ fontFamily: "var(--font-blackletter)" }}
    >
      The Agent Times
    </span>
  );

  if (!flanked) return <div className={className}>{name}</div>;

  return (
    <div className={`flex items-center justify-center gap-5 ${className}`}>
      <span className="hidden h-px flex-1 bg-border sm:block" />
      {name}
      <span className="hidden h-px flex-1 bg-border sm:block" />
    </div>
  );
}

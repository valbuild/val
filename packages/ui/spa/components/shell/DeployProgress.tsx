/*
 * "Publishing 42%" used to sit beside the deploy summary as its own item. The
 * status bar has one publish indicator now (`DeploymentsStatus`), with the
 * step and the percentage behind it on hover; the bar stays for the list's
 * running row.
 */

/** The thin bar a running publish draws beside its percentage. */
export function ProgressBar({
  percent,
  className,
}: {
  percent: number;
  className?: string;
}) {
  return (
    <span
      className={`block h-1 overflow-hidden rounded-full bg-border-primary ${className ?? ""}`}
    >
      <span
        className="block h-full rounded-full bg-bg-brand-secondary transition-[width] duration-500"
        style={{ width: `${percent}%` }}
      />
    </span>
  );
}

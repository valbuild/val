import { Progress } from "./designSystem/progress";
import { Button } from "./designSystem/button";
import { cn } from "./designSystem/cn";

const count = new Intl.NumberFormat();

/**
 * How far loading content has got, for something that has to see all of it
 * before its answer is whole: search, and a library entry's "used by".
 *
 * At 10,000 `.jsonValues()` entries that takes a while, and the decision for
 * phase 10 was that it may, as long as it says so and blocks nothing: the
 * entries arrive in batches and the rest of the Studio is usable meanwhile.
 * So this is a bar with the counts, not a spinner: "2,300 of 10,000" says the
 * wait is real and ends.
 */
export function ContentLoadProgress({
  label,
  loaded,
  total,
  className,
}: {
  /** What is waiting for the content: "Loading content to search". */
  label: string;
  loaded: number;
  total: number;
  className?: string;
}) {
  const percentage = total === 0 ? 0 : Math.floor((loaded / total) * 100);
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-baseline justify-between gap-2 text-[0.6875rem] text-fg-secondary-alt">
        <span>{label}…</span>
        {total > 0 && (
          <span className="tabular-nums shrink-0">
            {count.format(loaded)} of {count.format(total)}
          </span>
        )}
      </div>
      <Progress
        value={percentage}
        aria-label={label}
        aria-valuetext={
          total > 0
            ? `${count.format(loaded)} of ${count.format(total)}`
            : undefined
        }
        className="h-1"
      />
    </div>
  );
}

/**
 * Content that could not be loaded, so an answer built on it may be missing
 * something: what happened in the person's terms, the server's words under
 * "Details", and Try again when there is something to try.
 */
export function ContentLoadError({
  what,
  message,
  retry,
  className,
}: {
  /** What is incomplete because of it: "these results". */
  what: string;
  message: string;
  retry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-1 text-[0.6875rem] text-fg-secondary-alt",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span>
          Some content could not be loaded, so {what} may be incomplete.
        </span>
        {retry && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0 h-6 px-2 text-[0.6875rem]"
            onClick={retry}
          >
            Try again
          </Button>
        )}
      </div>
      <details>
        <summary className="cursor-pointer select-none">Details</summary>
        <p className="mt-1 break-words">{message}</p>
      </details>
    </div>
  );
}

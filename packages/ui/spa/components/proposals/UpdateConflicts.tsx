import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../designSystem/cn";
import type { UpdateConflictView } from "./PublishProposalDialog";

/**
 * Update from the site, when the site and the proposal both changed the same
 * thing since the proposal started (valbuild/home `docs/hosted-publishing.md`,
 * step 8.2). Each is decided here -- the site's, or this proposal's -- and
 * then the update merges with those decisions. Nothing is merged until every
 * one is decided, and leaving changes nothing.
 *
 * The same value on both sides is still a conflict, and shown as one: it is an
 * easy decision, but a decision.
 */
export function UpdateConflicts({
  conflicts,
  updating,
  onResolve,
  onCancel,
}: {
  conflicts: UpdateConflictView[];
  updating: boolean;
  onResolve?: (keep: ("site" | "proposal")[]) => void;
  onCancel?: () => void;
}) {
  const [keep, setKeep] = useState<("site" | "proposal" | null)[]>(() =>
    conflicts.map(() => null),
  );
  const decided = keep.every((choice) => choice !== null);
  const invalid = conflicts.some((conflict) => conflict.kind === "invalid");
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-fg-primary">
        {conflicts.length === 1
          ? "The site and this proposal both changed this since the proposal started. Choose which to keep:"
          : `The site and this proposal both changed these ${conflicts.length} things since the proposal started. Choose which to keep:`}
      </p>
      <ul className="flex flex-col gap-2">
        {conflicts.map((conflict, at) => (
          <li
            key={conflictKey(conflict)}
            className="flex flex-col gap-1.5 rounded-md border border-border-float px-3 py-2 text-xs"
          >
            <span className="font-medium text-fg-primary">
              {where(conflict)}
            </span>
            {conflict.kind === "invalid" ? (
              <span className="text-fg-secondary">{conflict.message}</span>
            ) : (
              <span className="flex flex-col gap-1">
                {(["site", "proposal"] as const).map((side) => (
                  <label
                    key={side}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded px-1 py-0.5",
                      keep[at] === side && "bg-bg-proposal-soft",
                    )}
                  >
                    <input
                      type="radio"
                      name={`conflict-${at}`}
                      checked={keep[at] === side}
                      onChange={() =>
                        setKeep((now) =>
                          now.map((choice, i) => (i === at ? side : choice)),
                        )
                      }
                    />
                    <span>
                      <span className="text-fg-secondary">
                        {side === "site"
                          ? "Keep the site's: "
                          : "Keep this proposal's: "}
                      </span>
                      <span className="text-fg-primary">
                        {conflict.kind === "code"
                          ? changeOf(conflict.base, conflict[side])
                          : shown(conflict[side])}
                      </span>
                    </span>
                  </label>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
      {invalid && (
        <p role="alert" className="text-xs text-fg-secondary">
          The merge would leave content this site&apos;s fields do not allow,
          and that is not chosen here. Change it in this proposal or on the
          site, save, then update again.
        </p>
      )}
      <div className="flex justify-end gap-2">
        {onCancel !== undefined && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-8 items-center rounded-md px-3 text-xs font-medium text-fg-primary hover:bg-bg-float-raised"
          >
            Not now
          </button>
        )}
        {!invalid && onResolve !== undefined && (
          <button
            type="button"
            disabled={!decided || updating}
            onClick={() =>
              onResolve(
                keep.map((choice) => (choice === "site" ? "site" : "proposal")),
              )
            }
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-bg-proposal px-3 text-xs font-medium text-fg-on-proposal disabled:bg-bg-disabled disabled:text-fg-disabled"
          >
            {updating && <Loader2 size={13} className="animate-spin" />}
            {updating ? "Updating from the site…" : "Update from the site"}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Which conflict this is, or which a decision is about: the file, or the
 * module and the field. Decisions belong to a conflict by this, never by
 * where it is in the list -- the next answer can be a different list.
 */
export function conflictKey(
  at: { file: string } | { moduleFilePath: string; path: string[] },
): string {
  return "file" in at
    ? `file:${at.file}`
    : `${at.moduleFilePath}?${at.path.join("/")}`;
}

/** Where a conflict is: the file; or the page, then the field, by its keys. */
function where(conflict: UpdateConflictView): string {
  if (conflict.kind === "code") return conflict.file;
  const page = conflict.moduleFilePath.replace(/^\//, "");
  return conflict.path.length === 0
    ? page
    : `${page} › ${conflict.path.join(" › ")}`;
}

/**
 * What one side did to a file since the proposal started, in a line: the
 * file is the decision, and its lines are for an editor to open, not to read
 * here.
 */
function changeOf(base: string | null, text: string | null): string {
  if (text === null) return "deleted";
  const lines = text.split("\n");
  if (base === null) return `added (${lines.length} lines)`;
  const before = base.split("\n");
  const counts = new Map<string, number>();
  for (const line of before) counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of lines) {
    const left = counts.get(line) ?? 0;
    if (left > 0) counts.set(line, left - 1);
    else added++;
  }
  const removed = [...counts.values()].reduce((sum, n) => sum + n, 0);
  return `changed (+${added} −${removed} lines)`;
}

/** A value, short enough for one line. A file by its name, and its alt text. */
function shown(value: unknown): string {
  if (value === undefined) return "(removed)";
  if (typeof value === "string") return value === "" ? "(empty)" : value;
  if (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    typeof value.path === "string"
  ) {
    const name = value.path.split("/").pop() ?? value.path;
    return "alt" in value && typeof value.alt === "string" && value.alt !== ""
      ? `${name} (${value.alt})`
      : name;
  }
  const text = JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

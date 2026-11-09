import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ModuleFilePath, PatchId } from "@valbuild/core";
import { Check, Copy, Sparkles, Trash2 } from "lucide-react";
import { useValSystem } from "../stores/react/SystemContext";
import type { HeldEdit } from "../stores/StatusStore";
import type { PatchRecord } from "../stores/types";
import { copyText } from "../utils/copyText";
import { Button } from "./designSystem/button";
import { useAIChatActions } from "./AIChatActionsContext";

/**
 * Edits that stopped fitting when their module's code changed, and what the
 * editor can do about them.
 *
 * They are held, not deleted (`HeldEdit`): a field renamed or removed under a
 * pending edit to it would otherwise take the editor's work with it. Held, an
 * edit applies nowhere and stops a publish. So the banner shows each one as
 * what was WRITTEN -- the field it went to and the value -- because "make the
 * change again where the field is now" asks for work it would otherwise not
 * show: the value can be copied, and each edit discarded on its own once it
 * has been made again (or is not wanted). Where the assistant can be asked,
 * each edit also offers to have it make the change where the field is now
 * (`heldEditPrompt`): the editor still discards the held edit, once the
 * assistant's change is the one they want.
 */
export function HeldEditsBanner() {
  const val = useValSystem();
  // `canMentionField`, not `isAIChatEnabled`: an assistant that is still
  // connecting, or a layout with no live chat, would open nothing.
  const { canMentionField, askAssistant } = useAIChatActions();
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (val === null) return () => {};
      return val.system.status.events.on("status:change", onChange);
    },
    [val],
  );
  const getSnapshot = useCallback(
    () => (val === null ? NONE : val.system.status.current().held),
    [val],
  );
  const held = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (val === null || held.length === 0) return null;
  const edits = heldEditsOf(
    val.system.patchStore.recordsFor(held.map((edit) => edit.patchId)),
    held,
  );
  return (
    <HeldEditsList
      edits={edits}
      onDiscard={(patchIds) => val.system.discard(patchIds)}
      {...(canMentionField ? { askAssistant } : {})}
    />
  );
}

/** One change a held edit makes, as the editor can read it. */
export type HeldChange = {
  /** Where it was written, in the module: `"title"`, `"sections.0.text"`. */
  path: string;
  value:
    | { kind: "text"; text: string }
    | { kind: "removed" }
    | { kind: "moved"; from: string };
};

/** A held edit, as the banner shows it. */
export type HeldEditView = {
  patchId: PatchId;
  moduleFilePath: ModuleFilePath;
  changes: HeldChange[];
  /** Why it does not apply, as the engine said it: for Details. */
  why: string;
};

/**
 * What the assistant is asked, to move a held edit: the module, each change as
 * the editor would read it, and that it is to be made where the field is NOW.
 * It is not asked to discard the held edit -- that stays the editor's, once
 * they have seen the change it made.
 */
export function heldEditPrompt(edit: HeldEditView): string {
  const changes = edit.changes.map((change) => {
    const where =
      change.path === "" ? "the module's root" : `\`${change.path}\``;
    switch (change.value.kind) {
      case "text":
        return `- ${where} was set to:\n\n\`\`\`\n${change.value.text}\n\`\`\``;
      case "removed":
        return `- ${where} was removed.`;
      case "moved":
        return `- ${where} was moved there from \`${change.value.from}\`.`;
    }
  });
  return [
    `An edit to ${edit.moduleFilePath} no longer fits its schema: the code changed under it, so it is held and applies nowhere. This is what it did:`,
    "",
    ...(changes.length > 0 ? changes : ["- (no change an editor typed)"]),
    "",
    `Find where each of those fields is in the module now, and make the same change there. Change nothing else. The engine's reason it does not apply: ${sentence(edit.why)}`,
    "",
    "Tell me when it is done, and I will discard the held edit.",
  ].join("\n");
}

/** What each held edit wrote, from its record. Bytes of a file are not. */
export function heldEditsOf(
  records: readonly PatchRecord[],
  held: readonly HeldEdit[],
): HeldEditView[] {
  return held.map((edit) => {
    const record = records.find((r) => r.patchId === edit.patchId);
    const changes: HeldChange[] = [];
    for (const op of record?.patch ?? []) {
      switch (op.op) {
        case "add":
        case "replace":
          changes.push({
            path: pathOf(op.path),
            value: { kind: "text", text: textOf(op.value) },
          });
          break;
        case "remove":
          changes.push({ path: pathOf(op.path), value: { kind: "removed" } });
          break;
        case "move":
        case "copy":
          changes.push({
            path: pathOf(op.path),
            value: { kind: "moved", from: pathOf(op.from) },
          });
          break;
        default:
          // `file` (bytes, shown as the media the replace beside it names)
          // and `test` write nothing an editor typed.
          break;
      }
    }
    return {
      patchId: edit.patchId,
      moduleFilePath: edit.moduleFilePath,
      changes,
      why: edit.message,
    };
  });
}

function pathOf(path: readonly (string | number)[]): string {
  return path.join(".");
}

/** A message as a sentence: ends with a full stop. */
function sentence(message: string): string {
  const trimmed = message.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** A value as text to read and copy: a string as it is, else its JSON. */
function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? null, null, 2);
}

type DiscardResult =
  | { status: "discarded" }
  | { status: "failed"; message: string };

/**
 * Ask for the banner to be shown and focused: what a refused publish
 * (`held-edits`) offers beside its message, since the edits it names are
 * settled here.
 */
export function showHeldEdits(): void {
  for (const listener of showListeners) listener();
}
const showListeners = new Set<() => void>();

/** The banner's content, given the edits: the connected banner, and stories. */
export function HeldEditsList({
  edits,
  onDiscard,
  copy = copyText,
  askAssistant,
}: {
  edits: readonly HeldEditView[];
  onDiscard: (patchIds: PatchId[]) => Promise<DiscardResult>;
  copy?: (text: string) => void;
  /** Absent where the assistant cannot be asked: the button is not shown. */
  askAssistant?: (prompt: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const show = () => {
      root.current?.scrollIntoView?.({ block: "nearest" });
      root.current?.focus();
    };
    showListeners.add(show);
    return () => {
      showListeners.delete(show);
    };
  }, []);
  /** Discards running and failed, by patch id, or `ALL` for every edit. */
  const [discarding, setDiscarding] = useState<ReadonlySet<string>>(EMPTY);
  const [failed, setFailed] = useState<ReadonlyMap<string, string>>(new Map());
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (copied === null) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const discard = (key: string, patchIds: PatchId[]) => {
    setDiscarding((now) => new Set(now).add(key));
    setFailed((now) => without(now, key));
    void onDiscard(patchIds)
      .then((result) => {
        if (result.status === "failed") {
          setFailed((now) => new Map(now).set(key, result.message));
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setFailed((now) => new Map(now).set(key, message));
      })
      .finally(() =>
        setDiscarding((now) => {
          const next = new Set(now);
          next.delete(key);
          return next;
        }),
      );
  };

  const one = edits.length === 1;
  const allFailed = failed.get(ALL);
  return (
    <div
      ref={root}
      role="alert"
      tabIndex={-1}
      className="flex flex-col gap-2 px-3 py-2 bg-bg-warning-primary text-fg-warning-primary text-sm outline-none"
    >
      <div>
        <strong>
          {one
            ? "An edit does not fit the new schema."
            : `${edits.length} edits do not fit the new schema.`}
        </strong>{" "}
        The code changed under {one ? "it, so it is" : "them, so they are"} kept
        but not shown, and publishing waits until {one ? "it is" : "they are"}{" "}
        settled. Copy what was written and make the change again where the field
        is now
        {askAssistant !== undefined ? ", or have the assistant do it" : ""}.
        Then discard {one ? "the edit" : "each edit"}, or discard{" "}
        {one ? "it" : "them"} right away if {one ? "it is" : "they are"} not
        wanted.
      </div>
      <ul className="flex flex-col gap-2">
        {edits.map((edit) => {
          const error = failed.get(edit.patchId);
          const busy = discarding.has(edit.patchId) || discarding.has(ALL);
          return (
            <li
              key={edit.patchId}
              className="flex flex-col gap-1.5 rounded-md border border-border-primary bg-bg-primary p-2 text-fg-primary"
            >
              {edit.changes.length === 0 ? (
                <code className="text-xs">{edit.moduleFilePath}</code>
              ) : (
                edit.changes.map((change, index) => {
                  const copyKey = `${edit.patchId}\0${index}`;
                  return (
                    <div key={index} className="flex flex-col gap-1">
                      <code className="text-xs text-fg-secondary">
                        {edit.moduleFilePath}
                        {change.path !== "" ? ` › ${change.path}` : ""}
                      </code>
                      {change.value.kind === "text" ? (
                        <div className="flex items-start gap-2">
                          <pre className="min-w-0 flex-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-bg-secondary px-2 py-1 font-sans text-sm select-text">
                            {change.value.text}
                          </pre>
                          <Button
                            variant="secondary"
                            size="xs"
                            aria-label={`Copy what was written to ${change.path || edit.moduleFilePath}`}
                            onClick={() => {
                              if (change.value.kind !== "text") return;
                              copy(change.value.text);
                              setCopied(copyKey);
                            }}
                          >
                            {copied === copyKey ? (
                              <>
                                <Check size={14} /> Copied
                              </>
                            ) : (
                              <>
                                <Copy size={14} /> Copy
                              </>
                            )}
                          </Button>
                        </div>
                      ) : (
                        <div className="text-sm text-fg-secondary">
                          {change.value.kind === "removed"
                            ? "Removed."
                            : `Moved here from ${change.value.from}.`}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              {error !== undefined && (
                <div className="text-sm text-fg-error-primary">
                  Could not discard this edit: {sentence(error)} Nothing was
                  lost.
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="warning"
                  size="xs"
                  disabled={busy}
                  onClick={() => discard(edit.patchId, [edit.patchId])}
                >
                  <Trash2 size={14} />{" "}
                  {error !== undefined ? "Try again" : "Discard this edit"}
                </Button>
                {askAssistant !== undefined && edit.changes.length > 0 && (
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => askAssistant(heldEditPrompt(edit))}
                  >
                    <Sparkles size={14} /> Have the assistant move it
                  </Button>
                )}
                <details className="text-xs text-fg-secondary">
                  <summary className="cursor-pointer">Details</summary>
                  {edit.why}
                </details>
              </div>
            </li>
          );
        })}
      </ul>
      {allFailed !== undefined && (
        <div>
          Could not discard them: {sentence(allFailed)} Nothing was lost.
        </div>
      )}
      {!one && (
        <div>
          <Button
            variant="warning"
            size="xs"
            disabled={discarding.has(ALL)}
            onClick={() =>
              discard(
                ALL,
                edits.map((edit) => edit.patchId),
              )
            }
          >
            {allFailed !== undefined
              ? "Try again"
              : `Discard all ${edits.length} edits`}
          </Button>
        </div>
      )}
    </div>
  );
}

function without(
  map: ReadonlyMap<string, string>,
  key: string,
): ReadonlyMap<string, string> {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
}

const ALL = "\0all";
const EMPTY: ReadonlySet<string> = new Set();
const NONE: readonly HeldEdit[] = [];

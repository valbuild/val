import { useCallback, useState, useSyncExternalStore } from "react";
import { useValSystem } from "../stores/react/SystemContext";
import type { HeldEdit } from "../stores/StatusStore";
import type { System } from "../stores/createSystem";
import { Button } from "./designSystem/button";

/**
 * Edits that stopped fitting when their module's code changed, and what the
 * editor can do about them.
 *
 * They are held, not deleted (`HeldEdit`): a field renamed or removed under a
 * pending edit to it would otherwise take the editor's work with it. Held, an
 * edit applies nowhere and stops a publish, so the banner says which edits
 * they are and offers the one thing that settles them here: discard. Moving
 * one to where the field went is a change to the content, which the editor
 * (or the assistant, from the field's new name) makes as any other.
 */
export function HeldEditsBanner() {
  const val = useValSystem();
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
  const [discarding, setDiscarding] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  if (val === null || held.length === 0) return null;
  const discard = () => {
    setDiscarding(true);
    setFailed(null);
    void val.system
      .discard(held.map((edit) => edit.patchId))
      .then((result) => {
        if (result.status === "failed") setFailed(result.message);
      })
      .catch((error: unknown) =>
        setFailed(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => setDiscarding(false));
  };
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 px-3 py-2 bg-bg-warning-primary text-fg-warning-primary text-sm"
    >
      <div>
        <strong>
          {held.length === 1
            ? "An edit does not fit the new schema."
            : `${held.length} edits do not fit the new schema.`}
        </strong>{" "}
        The code changed under{" "}
        {held.length === 1 ? "it, so it is" : "them, so they are"} kept but not
        shown, and publishing waits until they are settled. Discard{" "}
        {held.length === 1 ? "it" : "them"}, or make the change again where the
        field is now.
      </div>
      <ul className="list-disc list-inside">
        {describeHeld(val.system, held).map((line, index) => (
          <li key={index}>
            <code>{line}</code>
          </li>
        ))}
      </ul>
      {failed !== null ? (
        <div>Could not discard: {failed}. Nothing was lost; try again.</div>
      ) : null}
      <div>
        <Button
          variant="warning"
          size="xs"
          disabled={discarding}
          onClick={discard}
        >
          {failed !== null
            ? "Try again"
            : held.length === 1
              ? "Discard this edit"
              : "Discard these edits"}
        </Button>
      </div>
    </div>
  );
}

/** Where each held edit was made: its module, and the field it wrote. */
function describeHeld(system: System, held: readonly HeldEdit[]): string[] {
  const records = system.patchStore.recordsFor(
    held.map((edit) => edit.patchId),
  );
  return held.map((edit) => {
    const record = records.find((r) => r.patchId === edit.patchId);
    const op = record?.patch.find((candidate) => candidate.op !== "file");
    const at = op !== undefined && "path" in op ? op.path.join(".") : "";
    return at === "" ? edit.moduleFilePath : `${edit.moduleFilePath}: ${at}`;
  });
}

const NONE: readonly HeldEdit[] = [];

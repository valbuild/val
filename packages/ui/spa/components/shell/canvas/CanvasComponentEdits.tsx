import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Internal, type SourcePath } from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";
import type { ValCanvasComponentEdit } from "@valbuild/shared/internal";
import { useValSystem } from "../../../stores/react/SystemContext";
import { writePatch } from "../../../stores/react/writePatch";
import { useEmptyOf } from "../../../hooks/useEmptyOf";
import { useSchemaAtPath } from "../../ValFieldProvider";
import { useValPortal } from "../../ValPortalProvider";
import { Button } from "../../designSystem/button";
import { Dialog, DialogContent, DialogTitle } from "../../designSystem/dialog";
import {
  componentEditPatch,
  componentInsertPatch,
  listItemSchemaOf,
} from "../../../utils/componentEdit";

type Insert = Extract<ValCanvasComponentEdit, { op: "insert" }>;

/** Told where a new item landed, once it has been written. */
export type OnComponentAdded = (path: SourcePath) => void;

/**
 * What the canvas does with an edit the page asked for.
 *
 * `ValComponentEditor` lets an editor arrange a list of components on the
 * page itself, and the page can only ASK: the Studio is the one writer. A
 * move and a removal are written at once. So is an addition, as soon as the
 * list's schema is known: an empty item, which for a list of sections of
 * several kinds is the first kind - the editor switches it in the item's own
 * field, where every other value of it is edited too.
 *
 * `onAdded` is told where the new item landed, so the canvas can open it and
 * put the cursor in it: a section that was just added is the next thing to
 * fill in.
 */
export function useCanvasComponentEdits(): {
  onComponentEdit: (
    edit: ValCanvasComponentEdit,
    onAdded: OnComponentAdded,
  ) => void;
  dialog: ReactNode;
} {
  const val = useValSystem();
  const [insert, setInsert] = useState<{
    at: Insert;
    onAdded: OnComponentAdded;
  } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const write = useCallback(
    async (target: ReturnType<typeof componentEditPatch>): Promise<boolean> => {
      if (val === null) {
        setFailure("The Studio is not ready to save edits yet.");
        return false;
      }
      const res = await writePatch(
        val.system,
        target.moduleFilePath,
        target.patch,
      );
      if (res.status === "error") {
        Internal.log.error("could not write the page's edit", res.message);
        setFailure(res.message);
        return false;
      }
      return true;
    },
    [val],
  );

  const onComponentEdit = useCallback(
    (edit: ValCanvasComponentEdit, onAdded: OnComponentAdded) => {
      if (edit.op === "insert") {
        setInsert({ at: edit, onAdded });
        return;
      }
      void write(componentEditPatch(edit));
    },
    [write],
  );

  const add = useCallback(
    async (at: Insert, value: JSONValue, onAdded: OnComponentAdded) => {
      const target = componentInsertPatch(at.list, at.index, value);
      setInsert(null);
      if (await write(target)) {
        onAdded(target.itemPath);
      }
    },
    [write],
  );

  const dialog = (
    <>
      {insert !== null && (
        <PendingInsert
          // A new request is a new insert, whatever was pending
          key={`${insert.at.list}:${insert.at.index}`}
          insert={insert.at}
          onAdd={(at, value) => add(at, value, insert.onAdded)}
          onClose={() => setInsert(null)}
        />
      )}
      {failure !== null && (
        <EditFailedDialog message={failure} onClose={() => setFailure(null)} />
      )}
    </>
  );
  return { onComponentEdit, dialog };
}

/**
 * An addition waiting for the list's schema, which says what an empty item
 * is. It is written once that is known, and draws nothing - unless the list
 * is not one the Studio knows.
 */
function PendingInsert({
  insert,
  onAdd,
  onClose,
}: {
  insert: Insert;
  onAdd: (at: Insert, value: JSONValue) => void;
  onClose: () => void;
}) {
  const portalContainer = useValPortal();
  const emptyOf = useEmptyOf();
  const schemaAtPath = useSchemaAtPath(insert.list);
  const item =
    schemaAtPath.status === "success"
      ? listItemSchemaOf(schemaAtPath.data)
      : null;

  // Written once: an effect can run twice for one value
  const added = useRef(false);
  useEffect(() => {
    if (item === null || added.current) return;
    added.current = true;
    onAdd(insert, emptyOf(item));
  }, [item, insert, onAdd, emptyOf]);

  if (schemaAtPath.status === "loading" || item !== null) {
    return null;
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        container={portalContainer}
        className="max-w-md p-6 rounded-lg bg-bg-primary text-fg-primary"
      >
        <DialogTitle>Could not add a section here</DialogTitle>
        <p>
          The Studio does not know the list this page asked to add to. The page
          may be showing a different version of the site than the one the Studio
          has loaded, which a reload puts right.
        </p>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>
            Not now
          </Button>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The edit did not happen. Nothing was changed on the page either: it shows
 * what the Studio holds, and the Studio holds what it held before.
 */
function EditFailedDialog({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  const portalContainer = useValPortal();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        container={portalContainer}
        className="max-w-md p-6 rounded-lg bg-bg-primary text-fg-primary"
      >
        <DialogTitle>That change was not made</DialogTitle>
        <p>The page is as it was, so you can try the same change again.</p>
        <details className="text-sm text-fg-secondary">
          <summary>Details</summary>
          <p className="mt-1 break-words">{message}</p>
        </details>
        <div className="flex gap-2 justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

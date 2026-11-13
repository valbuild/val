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
  componentChoicesOf,
  componentEditPatch,
  componentInsertPatch,
  type ComponentKind,
} from "../../../utils/componentEdit";

type Insert = Extract<ValCanvasComponentEdit, { op: "insert" }>;

/**
 * What the canvas does with an edit the page asked for.
 *
 * `ValComponentEditor` lets an editor arrange a list of components on the
 * page itself, and the page can only ASK: the Studio is the one writer. A
 * move and a removal are written at once. An addition may need an answer
 * first - which kind of section - so it becomes a dialog, and is written when
 * the editor has chosen.
 *
 * `onAdded` is told where a new item landed, so the shell can open its
 * fields: a section that was just added is the next thing to fill in.
 */
export function useCanvasComponentEdits(onAdded: (path: SourcePath) => void): {
  onComponentEdit: (edit: ValCanvasComponentEdit) => void;
  dialog: ReactNode;
} {
  const val = useValSystem();
  const [insert, setInsert] = useState<Insert | null>(null);
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
    (edit: ValCanvasComponentEdit) => {
      if (edit.op === "insert") {
        setInsert(edit);
        return;
      }
      void write(componentEditPatch(edit));
    },
    [write],
  );

  const add = useCallback(
    async (at: Insert, value: JSONValue) => {
      const target = componentInsertPatch(at.list, at.index, value);
      setInsert(null);
      if (await write(target)) {
        onAdded(target.itemPath);
      }
    },
    [write, onAdded],
  );

  const dialog = (
    <>
      {insert !== null && (
        <AddComponentDialog
          // A new request is a new dialog, whatever it was showing
          key={`${insert.list}:${insert.index}`}
          insert={insert}
          onAdd={add}
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
 * Which kind of section to add.
 *
 * A list of one kind is not asked about: there is one answer, so the item is
 * added as soon as the schema is known. A union lists its variants.
 */
function AddComponentDialog({
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
  const choices =
    schemaAtPath.status === "success"
      ? componentChoicesOf(schemaAtPath.data)
      : null;

  // The one kind there is, added without asking - once.
  const added = useRef(false);
  const only = choices?.status === "one" ? choices.schema : null;
  useEffect(() => {
    if (only === null || added.current) return;
    added.current = true;
    onAdd(insert, emptyOf(only));
  }, [only, insert, onAdd, emptyOf]);

  if (schemaAtPath.status === "loading" || choices?.status === "one") {
    return null;
  }
  if (choices?.status !== "kinds") {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          container={portalContainer}
          className="max-w-md p-6 rounded-lg bg-bg-primary text-fg-primary"
        >
          <DialogTitle>Could not add a section here</DialogTitle>
          <p>
            The Studio does not know the list this page asked to add to. The
            page may be showing a different version of the site than the one the
            Studio has loaded, which a reload puts right.
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
  const { key, kinds } = choices;
  const choose = (kind: ComponentKind) => {
    const empty = emptyOf(kind.schema);
    onAdd(insert, {
      ...(typeof empty === "object" && empty !== null && !Array.isArray(empty)
        ? empty
        : {}),
      [key]: kind.value,
    });
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        container={portalContainer}
        className="max-w-md p-6 rounded-lg bg-bg-primary text-fg-primary"
      >
        <DialogTitle>Add a section</DialogTitle>
        <ul className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
          {kinds.map((kind) => (
            <li key={kind.value}>
              <button
                type="button"
                data-testid={`add-component-${kind.value}`}
                onClick={() => choose(kind)}
                className="w-full text-left px-4 py-3 rounded-lg border border-border-primary hover:bg-bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-border-brand-primary"
              >
                <span className="block font-medium">{kind.value}</span>
                {kind.description !== undefined && (
                  <span className="block text-sm text-fg-secondary">
                    {kind.description}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
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

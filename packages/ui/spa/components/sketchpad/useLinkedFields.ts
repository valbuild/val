import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "../designSystem/sonner";
import { useAllSources, useSchemas } from "../ValFieldProvider";
import { useValSystem } from "../../stores/react/SystemContext";
import { writePatch } from "../../stores/react/writePatch";
import { stringFieldPatch } from "../fields/stringFieldPatch";
import {
  fieldLinkInfo,
  linkedFieldChanges,
  splitField,
  type FieldLinkInfo,
} from "./fieldLinks";

/** How long typing in a linked block rests before the field is written. */
export const LINKED_FIELD_WRITE_DELAY_MS = 400;

/**
 * The Studio's side of a sketch's field links (`fieldLinks.ts`): what each
 * linked field is now, for the blocks to show, and `write`, which takes the
 * sketch before and after an edit and writes every linked field whose text
 * changed -- through the same patch a text field writes.
 *
 * A field's write waits until typing in it rests, so a sentence is one
 * edit rather than one per letter, and is made on the way out if it has
 * not been yet.
 */
export function useLinkedFields(): {
  fieldInfo: ((field: string) => FieldLinkInfo) | undefined;
  write: (before: string, after: string) => void;
} {
  const val = useValSystem();
  const schemas = useSchemas();
  const sources = useAllSources();
  const fieldInfo = useMemo(
    () =>
      schemas.status === "success"
        ? (field: string) => fieldLinkInfo(field, schemas.data, sources)
        : undefined,
    [schemas, sources],
  );
  const fieldInfoRef = useRef(fieldInfo);
  fieldInfoRef.current = fieldInfo;

  const pending = useRef(
    new Map<string, { text: string; timer: ReturnType<typeof setTimeout> }>(),
  );

  const flushOne = useCallback(
    async (field: string, text: string) => {
      pending.current.delete(field);
      const info = fieldInfoRef.current?.(field);
      const at = splitField(field);
      // Only a text field that is there, and only when it is not already so.
      if (
        !val ||
        !at ||
        info?.status !== "ok" ||
        info.value.replace(/\s+/g, " ").trim() === text
      ) {
        return;
      }
      const res = await writePatch(
        val.system,
        at.moduleFilePath,
        stringFieldPatch(at.path, text),
      );
      if (res.status === "error") {
        toast.error(`“${info.label}” was not changed`, {
          id: `sketch-field:${field}`,
          description: res.message,
          action: {
            label: "Try again",
            onClick: () => void flushOne(field, text),
          },
        });
      }
    },
    [val],
  );

  const write = useCallback(
    (before: string, after: string) => {
      for (const { field, text } of linkedFieldChanges(before, after)) {
        const waiting = pending.current.get(field);
        if (waiting) {
          clearTimeout(waiting.timer);
        }
        pending.current.set(field, {
          text,
          timer: setTimeout(
            () => void flushOne(field, text),
            LINKED_FIELD_WRITE_DELAY_MS,
          ),
        });
      }
    },
    [flushOne],
  );

  // Closing the sketch does not drop the last edit to a field.
  useEffect(() => {
    const waiting = pending.current;
    return () => {
      waiting.forEach(({ text, timer }, field) => {
        clearTimeout(timer);
        void flushOne(field, text);
      });
    };
  }, [flushOne]);

  return { fieldInfo, write };
}

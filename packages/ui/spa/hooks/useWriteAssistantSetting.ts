import { useCallback } from "react";
import { ModuleFilePath } from "@valbuild/core";
import {
  useAddPatch,
  useShallowSourceAtPath,
} from "../components/ValFieldProvider";
import { sourcePathOfItem } from "../utils/sourcePathOfItem";

/** The assistant's fields, in the order a new section is written with. */
export const ASSISTANT_FIELDS = ["enabled", "context", "tone"] as const;

export type AssistantField = (typeof ASSISTANT_FIELDS)[number];

/**
 * Write one of the assistant's settings, creating the section if it is absent.
 *
 * Two callers need this and they are far apart — the Settings panel, and the
 * prompt the assistant itself shows when nobody has turned it on — so the rule
 * about an absent section lives here rather than in both.
 *
 * That rule: a `replace` at `["assistant", field]` fails when there is nothing
 * at `assistant` to replace a key inside, and `{}` is the normal state of a
 * fresh settings module. So the first write writes the SECTION, with the other
 * fields as `null` — unset, and explicitly so, which is what the schema means
 * by an absent key too.
 */
export function useWriteAssistantSetting(
  moduleFilePath: ModuleFilePath,
): (field: AssistantField, value: string | boolean | null) => void {
  const { addPatch } = useAddPatch(moduleFilePath);
  const assistantPath = sourcePathOfItem(moduleFilePath, "assistant");
  const section = useShallowSourceAtPath(assistantPath, "settings");
  const hasSection =
    section.status === "success" && "data" in section && !!section.data;
  return useCallback(
    (field: AssistantField, value: string | boolean | null) => {
      if (hasSection) {
        addPatch(
          [{ op: "add", path: ["assistant", field], value }],
          "settings",
        );
        return;
      }
      const others: Record<string, null> = {};
      for (const key of ASSISTANT_FIELDS) {
        if (key !== field) {
          others[key] = null;
        }
      }
      addPatch(
        [
          {
            op: "add",
            path: ["assistant"],
            value: { ...others, [field]: value },
          },
        ],
        "settings",
      );
    },
    [addPatch, hasSection],
  );
}

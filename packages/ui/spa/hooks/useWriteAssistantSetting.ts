import { useCallback } from "react";
import { ModuleFilePath } from "@valbuild/core";
import { useWriteSettingsSection } from "./useWriteSettingsSection";

/** The assistant's fields, in the order a new section is written with. */
export const ASSISTANT_FIELDS = ["enabled", "context", "tone"] as const;

export type AssistantField = (typeof ASSISTANT_FIELDS)[number];

/**
 * Write one of the assistant's settings, creating the section if it is absent.
 *
 * Two callers need this and they are far apart — the Settings panel, and the
 * prompt the assistant itself shows when nobody has turned it on — so the rule
 * about an absent section is shared rather than written twice. It is now shared
 * one level further out, in {@link useWriteSettingsSection}, because it is true
 * of every settings section and not of this one in particular.
 */
export function useWriteAssistantSetting(
  moduleFilePath: ModuleFilePath,
): (field: AssistantField, value: string | boolean | null) => void {
  const write = useWriteSettingsSection(
    moduleFilePath,
    "assistant",
    ASSISTANT_FIELDS,
  );
  // One field at a time is all the assistant's callers have ever written: the
  // panel's fields are independent, and the prompt writes `enabled` alone. The
  // shared hook takes a set because the locales section needs to write two
  // together — see {@link useWriteSettingsSection}.
  return useCallback(
    (field: AssistantField, value: string | boolean | null) => {
      const changes: Partial<Record<AssistantField, string | boolean | null>> =
        {};
      changes[field] = value;
      write(changes);
    },
    [write],
  );
}

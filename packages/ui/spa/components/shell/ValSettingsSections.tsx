import { useCallback } from "react";
import {
  AI_SETTINGS_MAX_LENGTH,
  ModuleFilePath,
  SourcePath,
} from "@valbuild/core";
import { sourcePathOfItem } from "../../utils/sourcePathOfItem";
import {
  useAddPatch,
  useSchemaAtPath,
  useShallowSourceAtPath,
} from "../ValFieldProvider";
import { useValidationErrors } from "../ValErrorProvider";
import {
  AiSettingsFields,
  AiSettingsValue,
  NoSettingsModule,
} from "./SettingsPanel";
import { PanelSkeleton } from "./PanelPrimitives";

/**
 * The settings sections, wired to the store.
 *
 * The panel around them is presentational (see {@link SettingsPanel}); this is
 * the half that reads source and writes patches, mounted by `ValShell` through
 * the shell's `renderSettings` slot. Split for the same reason the editor is:
 * the sections need the module path to call their hooks with, and a project
 * without a settings module has none — so the connected half must be the part
 * that is not mounted at all in that case.
 */
export function ValSettingsSections({
  moduleFilePath,
}: {
  moduleFilePath?: ModuleFilePath;
}) {
  if (!moduleFilePath) {
    return <NoSettingsModule />;
  }
  return <Sections moduleFilePath={moduleFilePath} />;
}

function Sections({ moduleFilePath }: { moduleFilePath: ModuleFilePath }) {
  const settings = useShallowSourceAtPath(moduleFilePath, "settings");
  const schema = useSchemaAtPath(moduleFilePath);
  /**
   * The `ai` section's path, whether or not the section exists yet.
   *
   * Built rather than read out of the shallow source: the shallow source only
   * has the keys that are PRESENT, and the whole point of a settings module is
   * that a section may not be. The path is where the section WOULD be, which is
   * what a patch and a validation lookup both need.
   */
  const aiPath = sourcePathOfItem(moduleFilePath, "ai");
  const aiSource = useShallowSourceAtPath(aiPath, "settings");
  const contextPath = sourcePathOfItem(aiPath, "context");
  const tonePath = sourcePathOfItem(aiPath, "tone");
  const enabledValue = useAiEnabledField(sourcePathOfItem(aiPath, "enabled"));
  const contextValue = useAiField(contextPath);
  const toneValue = useAiField(tonePath);
  const contextErrors = useValidationErrors(contextPath);
  const toneErrors = useValidationErrors(tonePath);
  const { addPatch } = useAddPatch(moduleFilePath);
  const hasAiSection =
    "data" in aiSource && !!aiSource.data && aiSource.status === "success";

  const onAiChange = useCallback(
    (field: keyof AiSettingsValue, value: string | boolean | null) => {
      if (hasAiSection) {
        addPatch([{ op: "add", path: ["ai", field], value }], "settings");
        return;
      }
      /**
       * No `ai` section yet, so the section is what gets written.
       *
       * A `replace` at `["ai", field]` would fail: there is nothing at `ai` to
       * replace a key inside. The other field is written as `null` — unset, and
       * explicitly so, which is what the schema means by an absent key too.
       */
      const others: Record<string, null> = {};
      for (const key of AI_FIELDS) {
        if (key !== field) {
          others[key] = null;
        }
      }
      addPatch(
        [{ op: "add", path: ["ai"], value: { ...others, [field]: value } }],
        "settings",
      );
    },
    [addPatch, hasAiSection],
  );

  if (settings.status === "loading" || schema.status === "loading") {
    return <PanelSkeleton rows={4} />;
  }
  const readonly =
    schema.status === "success" ? !!schema.data.readonly : undefined;
  return (
    <AiSettingsFields
      value={{
        enabled: enabledValue,
        context: contextValue,
        tone: toneValue,
      }}
      onChange={onAiChange}
      maxLength={AI_SETTINGS_MAX_LENGTH}
      errors={{
        context: contextErrors[0]?.message,
        tone: toneErrors[0]?.message,
      }}
      readonly={readonly}
    />
  );
}

/**
 * One AI field's value, or `null` where it is unset.
 *
 * An absent key is not an error here, which is why this does not go through
 * `useValField`: "no value" is a normal state for a settings field, and the
 * panel draws it as an empty box rather than as a missing field.
 */
/** The AI section's fields, in the order a new section is written with. */
const AI_FIELDS: (keyof AiSettingsValue)[] = ["enabled", "context", "tone"];

/**
 * `ai.enabled`, where `null` means unset — which means ON.
 *
 * Unset is not the same as `false`, so this returns the tri-state rather than a
 * boolean: only the UI's `!== false` turns it into one, and only in one place.
 */
function useAiEnabledField(path: SourcePath): boolean | null {
  const source = useShallowSourceAtPath(path, "boolean");
  if ("data" in source && typeof source.data === "boolean") {
    return source.data;
  }
  return null;
}

function useAiField(path: SourcePath): string | null {
  const source = useShallowSourceAtPath(path, "string");
  if ("data" in source && typeof source.data === "string") {
    return source.data;
  }
  return null;
}

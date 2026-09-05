import { useMemo } from "react";
import {
  ASSISTANT_SETTINGS_MAX_LENGTH,
  ModuleFilePath,
  SourcePath,
} from "@valbuild/core";
import { sourcePathOfItem } from "../../utils/sourcePathOfItem";
import {
  useSchemaAtPath,
  useShallowSourceAtPath,
  useSourceAtPath,
} from "../ValFieldProvider";
import { useWriteAssistantSetting } from "../../hooks/useWriteAssistantSetting";
import { useWriteSettingsSection } from "../../hooks/useWriteSettingsSection";
import {
  useAllValidationErrors,
  useValidationErrors,
} from "../ValErrorProvider";
import {
  AssistantSettingsFields,
  LocalesSettingsFields,
  LocalesSettingsValue,
  NoSettingsModule,
  SettingsTabs,
} from "./SettingsPanel";
import { Languages, Sparkles } from "lucide-react";
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
   * The assistant section's path, whether or not the section exists yet.
   *
   * Built rather than read out of the shallow source: the shallow source only
   * has the keys that are PRESENT, and the whole point of a settings module is
   * that a section may not be. The path is where the section WOULD be, which is
   * what a patch and a validation lookup both need.
   */
  const assistantPath = sourcePathOfItem(moduleFilePath, "assistant");
  const contextPath = sourcePathOfItem(assistantPath, "context");
  const tonePath = sourcePathOfItem(assistantPath, "tone");
  const enabledValue = useAssistantEnabledField(
    sourcePathOfItem(assistantPath, "enabled"),
  );
  const contextValue = useAssistantField(contextPath);
  const toneValue = useAssistantField(tonePath);
  const contextErrors = useValidationErrors(contextPath);
  const toneErrors = useValidationErrors(tonePath);
  const writeAssistantSetting = useWriteAssistantSetting(moduleFilePath);
  const localesPath = sourcePathOfItem(moduleFilePath, "locales");
  const localesValue = useLocalesSection(localesPath);
  const localesErrors = useLocalesErrors(localesPath, localesValue.available);
  const writeLocalesSetting = useWriteSettingsSection(
    moduleFilePath,
    "locales",
    LOCALES_FIELDS,
  );

  if (settings.status === "loading" || schema.status === "loading") {
    return <PanelSkeleton rows={4} />;
  }
  const readonly =
    schema.status === "success" ? !!schema.data.readonly : undefined;
  return (
    <SettingsTabs
      tabs={[
        {
          id: "assistant",
          label: "Assistant",
          icon: Sparkles,
          content: (
            <AssistantSettingsFields
              value={{
                enabled: enabledValue,
                context: contextValue,
                tone: toneValue,
              }}
              onChange={writeAssistantSetting}
              maxLength={ASSISTANT_SETTINGS_MAX_LENGTH}
              errors={{
                context: contextErrors[0]?.message,
                tone: toneErrors[0]?.message,
              }}
              readonly={readonly}
            />
          ),
        },
        {
          id: "locales",
          label: "Locales",
          icon: Languages,
          content: (
            <LocalesSettingsFields
              value={localesValue}
              onChange={(next) => {
                // Only what changed. Removing the language that was the default
                // changes both, and writing a field that did not move would put
                // an identical value in the publish diff.
                if (next.available !== localesValue.available) {
                  writeLocalesSetting("available", next.available);
                }
                if (next.default !== localesValue.default) {
                  writeLocalesSetting("default", next.default);
                }
              }}
              errors={localesErrors}
              readonly={readonly}
            />
          ),
        },
      ]}
    />
  );
}

/** Every field the locales section has. See `useWriteSettingsSection`. */
const LOCALES_FIELDS = ["available", "default"] as const;

/**
 * The locales section, as the panel needs it.
 *
 * Read defensively rather than asserted: a settings module is a file someone
 * edits, so `available` can hold anything at the moment it is being typed, and
 * the panel has to draw the rows it CAN rather than refusing to render.
 */
function useLocalesSection(localesPath: SourcePath): LocalesSettingsValue {
  const availableSource = useSourceAtPath(
    sourcePathOfItem(localesPath, "available"),
  );
  const defaultSource = useShallowSourceAtPath(
    sourcePathOfItem(localesPath, "default"),
    "string",
  );
  return useMemo<LocalesSettingsValue>(() => {
    const raw =
      "data" in availableSource && Array.isArray(availableSource.data)
        ? availableSource.data
        : [];
    return {
      available: raw.filter((tag): tag is string => typeof tag === "string"),
      default:
        "data" in defaultSource && typeof defaultSource.data === "string"
          ? defaultSource.data
          : null,
    };
  }, [availableSource, defaultSource]);
}

/**
 * Validation for the locales section, arranged the way the fields want it.
 *
 * Errors arrive per source path — `available.2`, `default` — and the component
 * takes them per TAG, so a row keeps its message when the row above it is
 * removed. Resolving the index against the list is what connects the two.
 */
function useLocalesErrors(
  localesPath: SourcePath,
  available: string[],
): { byTag?: Record<string, string>; default?: string } {
  const availablePath = sourcePathOfItem(localesPath, "available");
  const allErrors = useAllValidationErrors() || {};
  const defaultErrors = useValidationErrors(
    sourcePathOfItem(localesPath, "default"),
  );
  return useMemo(() => {
    const byTag: Record<string, string> = {};
    for (let i = 0; i < available.length; i++) {
      const errors = allErrors[sourcePathOfItem(availablePath, i)];
      if (errors && errors.length > 0) {
        byTag[available[i]] = errors[0].message;
      }
    }
    return { byTag, default: defaultErrors[0]?.message };
  }, [allErrors, availablePath, available, defaultErrors]);
}

/**
 * One AI field's value, or `null` where it is unset.
 *
 * An absent key is not an error here, which is why this does not go through
 * `useValField`: "no value" is a normal state for a settings field, and the
 * panel draws it as an empty box rather than as a missing field.
 */

/**
 * `assistant.enabled`, where `null` means "nobody has decided".
 *
 * Returns the tri-state rather than a boolean: unset is not `false`, and the
 * difference is what the whole setting is for — see `assistantAvailability`.
 */
function useAssistantEnabledField(path: SourcePath): boolean | null {
  const source = useShallowSourceAtPath(path, "boolean");
  if ("data" in source && typeof source.data === "boolean") {
    return source.data;
  }
  return null;
}

function useAssistantField(path: SourcePath): string | null {
  const source = useShallowSourceAtPath(path, "string");
  if ("data" in source && typeof source.data === "string") {
    return source.data;
  }
  return null;
}

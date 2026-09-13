import { useMemo } from "react";
import type { Json } from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";
import {
  ASSISTANT_SETTINGS_MAX_LENGTH,
  ModuleFilePath,
  SourcePath,
  THEME_RADIUS_STEPS,
  ThemeRadius,
} from "@valbuild/core";
import { useCallback } from "react";
import { sourcePathOfItem } from "../../utils/sourcePathOfItem";
import { useAIChatActions } from "../AIChatActionsContext";
import { toneOfVoicePrompt } from "../../hooks/toneOfVoicePrompt";
import {
  useSchemaAtPath,
  useShallowSourceAtPath,
  useSourceAtPath,
} from "../ValFieldProvider";
import { useWriteAssistantSetting } from "../../hooks/useWriteAssistantSetting";
import { useWriteThemeSetting } from "../../hooks/useWriteThemeSetting";
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
  ThemeSettingsFields,
} from "./SettingsPanel";
import { Languages, Palette, Sparkles } from "lucide-react";
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
  /**
   * "Generate from my content", or nothing.
   *
   * `canMentionField` rather than `isAIChatEnabled`, and the difference is the
   * button being dead or absent: an assistant that is configured but whose
   * socket has not connected — or a layout with no chat surface at all — has
   * nowhere for the prompt to land, and `askAssistant` would open nothing.
   * A project that has said no to the assistant does not get offered a button
   * that asks it something either.
   */
  const { canMentionField, askAssistant } = useAIChatActions();
  const generateTone = useCallback(() => {
    askAssistant(toneOfVoicePrompt(moduleFilePath));
  }, [askAssistant, moduleFilePath]);

  const localesPath = sourcePathOfItem(moduleFilePath, "locales");
  const localesValue = useLocalesSection(localesPath);
  const localesErrors = useLocalesErrors(localesPath, localesValue.available);
  const writeLocalesSetting = useWriteSettingsSection(
    moduleFilePath,
    "locales",
    LOCALES_FIELDS,
  );

  const themePath = sourcePathOfItem(moduleFilePath, "theme");
  const accentPath = sourcePathOfItem(themePath, "accent");
  const radiusPath = sourcePathOfItem(themePath, "radius");
  const modePath = sourcePathOfItem(themePath, "mode");
  const accentValue = useThemeStringField(accentPath);
  const radiusValue = useThemeRadiusField(radiusPath);
  const modeValue = useThemeModeField(modePath);
  const accentErrors = useValidationErrors(accentPath);
  const radiusErrors = useValidationErrors(radiusPath);
  const modeErrors = useValidationErrors(modePath);
  const writeThemeSetting = useWriteThemeSetting(moduleFilePath);

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
              onGenerateTone={
                canMentionField && enabledValue !== false
                  ? generateTone
                  : undefined
              }
              readonly={readonly}
            />
          ),
        },
        {
          id: "theme",
          label: "Appearance",
          icon: Palette,
          content: (
            <ThemeSettingsFields
              value={{
                accent: accentValue,
                radius: radiusValue,
                mode: modeValue,
              }}
              onChange={writeThemeSetting}
              errors={{
                accent: accentErrors[0]?.message,
                radius: radiusErrors[0]?.message,
                mode: modeErrors[0]?.message,
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
                // `Json` is the readonly spelling of the same shape a patch op
                // takes — the same crossing `emptyOf` makes in
                // `DiscriminatedUnionField`. The values are the source's own,
                // carried through unchanged so a malformed entry is removed
                // rather than rewritten.
                writeLocalesSetting({
                  available: next.available as JSONValue[],
                });
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
const LOCALES_FIELDS = ["available"] as const;

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
  return useMemo<LocalesSettingsValue>(() => {
    // Every position, unfiltered. Validation reports by index, and the panel
    // removes by index, so dropping what is not a string here would put a
    // message on the wrong row and leave the value that caused it with no row
    // to be removed from. See `LocalesSettingsValue`.
    return {
      available:
        "data" in availableSource && Array.isArray(availableSource.data)
          ? availableSource.data
          : [],
    };
  }, [availableSource]);
}

/**
 * Validation for the locales section, arranged the way the fields want it.
 *
 * Errors arrive per source path — `available.2` — and the component takes them
 * per POSITION, which is the same thing with the path parsed off. Not per tag:
 * the duplicate-language rule reports on the repeat, and a tag-keyed map cannot
 * tell the repeat from the original.
 *
 * Between a removal and the next validation pass these are the PREVIOUS pass's
 * errors read against the new list, so a message can sit on a neighbour for a
 * frame. That resolves itself, and is true of any keying — the errors are
 * produced per index, so nothing the panel does can make them survive a shift.
 */
function useLocalesErrors(
  localesPath: SourcePath,
  available: Json[],
): { byIndex?: Record<number, string> } {
  const availablePath = sourcePathOfItem(localesPath, "available");
  const allErrors = useAllValidationErrors() || {};
  return useMemo(() => {
    const byIndex: Record<number, string> = {};
    for (let i = 0; i < available.length; i++) {
      const errors = allErrors[sourcePathOfItem(availablePath, i)];
      if (errors && errors.length > 0) {
        byIndex[i] = errors[0].message;
      }
    }
    return { byIndex };
  }, [allErrors, availablePath, available]);
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

/**
 * One of the theme's string fields, or `null` where it is unset.
 *
 * The same shape as `useAssistantField` and separate from it for the same
 * reason: an absent key is not an error here, so this does not go through
 * `useValField`.
 */
function useThemeStringField(path: SourcePath): string | null {
  const source = useShallowSourceAtPath(path, "string");
  if ("data" in source && typeof source.data === "string") {
    return source.data;
  }
  return null;
}

/**
 * `theme.radius`, checked against the steps that exist.
 *
 * Checked rather than passed through, for the reason `readThemeSettings` gives:
 * an unknown step from a hand-edited file would be looked up in
 * `THEME_RADIUS_LENGTHS` and produce `--radius: undefined`, which takes the
 * declaration down and squares every corner in the Studio. The panel shows it
 * as unset, and the validation error beside it says why.
 */
function useThemeRadiusField(path: SourcePath): ThemeRadius | null {
  const source = useShallowSourceAtPath(path, "enum");
  if ("data" in source) {
    return THEME_RADIUS_STEPS.find((step) => step === source.data) ?? null;
  }
  return null;
}

function useThemeModeField(path: SourcePath): "dark" | "light" | null {
  const source = useShallowSourceAtPath(path, "enum");
  if ("data" in source && (source.data === "dark" || source.data === "light")) {
    return source.data;
  }
  return null;
}

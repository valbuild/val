import { isAiEnabled } from "@valbuild/core";
import {
  useSchemas,
  useShallowSourceAtPath,
} from "../components/ValFieldProvider";
import { sourcePathOfItem } from "../utils/sourcePathOfItem";
import { settingsModuleFilePath } from "./aiProjectSettings";

/**
 * Whether the assistant is available in this project.
 *
 * The project's own answer, from `s.settings()` — `ai.enabled` — and no longer
 * from `val.config.ts`. It used to be `config.ai.chat.experimental.enable`,
 * which meant that turning the chat on for the people who edit the content took
 * a developer, a deploy, and a code review of a boolean.
 *
 * ## Unset means ON, and while loading too
 *
 * `null` is not `false` (see `AiSettingsSource.enabled`), and a project with no
 * settings module at all has said nothing — so both answer `true`. That is also
 * what this returns while the schemas are still loading: the affordance
 * appearing and then going for the few projects that turned it off is better
 * than it appearing late for everyone who did not.
 *
 * It is not the whole story downstream, and does not try to be: a project with
 * no reachable model gets `availableModel: null` from the socket and the chat
 * stays off whatever this says. This is the project's INTENT.
 */
export function useIsAiEnabled(): boolean {
  const schemas = useSchemas();
  const moduleFilePath =
    schemas.status === "success" ? settingsModuleFilePath(schemas.data) : null;
  const enabledPath = moduleFilePath
    ? sourcePathOfItem(sourcePathOfItem(moduleFilePath, "ai"), "enabled")
    : undefined;
  const source = useShallowSourceAtPath(enabledPath, "boolean");
  const enabled =
    "data" in source && typeof source.data === "boolean" ? source.data : null;
  // Through core rather than as `enabled !== false` here: consumer code reading
  // the settings module in an app needs the same answer, so the rule that unset
  // means on has one implementation.
  return isAiEnabled({ ai: { enabled } });
}

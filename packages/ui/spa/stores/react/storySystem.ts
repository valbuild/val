import type {
  Json,
  ModuleFilePath,
  ReifiedPreview,
  SerializedSchema,
} from "@valbuild/core";
import { createReadOnlySystem } from "../readOnlySystem";
import type { System } from "../createSystem";

/**
 * A store system fed from static mock data, for Storybook.
 *
 * The mechanism is `createReadOnlySystem`, which the history pane also uses —
 * see it for why a system fed with serialized schemas and plain JSON is the
 * right shape, and why such a system deliberately cannot write.
 */
export function createStorySystem({
  schemas,
  sources,
  previews,
}: {
  schemas: Record<ModuleFilePath, SerializedSchema | undefined>;
  sources: Record<ModuleFilePath, Json | undefined>;
  previews?: Record<ModuleFilePath, ReifiedPreview | null>;
}): System {
  return createReadOnlySystem({
    schemas,
    sources,
    previews,
    noServerReason: "No server in Storybook",
  });
}

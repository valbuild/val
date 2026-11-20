import type { Patch } from "@valbuild/core/patch";

/**
 * The patch a string field writes when typing pauses: the whole new value,
 * replacing the old one at the field's patch path.
 *
 * Its own function, rather than inline in `StringField`, so the scenario
 * harness (`scenarios/`) writes exactly what a field writes. A test that built
 * its own op would prove the test's op works, not the field's.
 */
export function stringFieldPatch(patchPath: string[], value: string): Patch {
  return [{ op: "replace", path: patchPath, value }];
}

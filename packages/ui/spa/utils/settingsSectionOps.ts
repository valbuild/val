import { JSONValue, Operation } from "@valbuild/core/patch";

/**
 * The patch that writes `changes` into a settings section: one `add` per field
 * when the section exists, or the whole section, with the other fields `null`,
 * when it does not. See `useWriteSettingsSection` for why.
 *
 * A function of its own so that everything that writes a setting writes it the
 * same way: the Settings panel, and the assistant's `request_web_search`.
 */
export function settingsSectionOps<Field extends string>(
  section: string,
  /** Every field the section has, so the ones not being written can be nulled. */
  fields: readonly Field[],
  changes: Partial<Record<Field, JSONValue>>,
  hasSection: boolean,
): Operation[] {
  // Walked as `fields` rather than as the changes' own keys: it keeps the
  // declared order, and it is what lets a field be told apart from one that
  // is merely absent without a cast off `Object.entries`.
  const changed = fields.filter((field) =>
    Object.prototype.hasOwnProperty.call(changes, field),
  );
  if (changed.length === 0) {
    return [];
  }
  if (hasSection) {
    return changed.map(
      (field): Operation => ({
        op: "add",
        path: [section, field],
        value: changes[field] ?? null,
      }),
    );
  }
  const value: Record<string, JSONValue> = {};
  for (const field of fields) {
    value[field] = changes[field] ?? null;
  }
  return [{ op: "add", path: [section], value }];
}

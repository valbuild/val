import {
  deserializeSchema,
  type SelectorSource,
  type SerializedSchema,
  type SourcePath,
  type ValidationError,
} from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";

/**
 * The second gate: does this old value actually FIT where it is going?
 *
 * `checkCompatibility` asks a different question — schema against schema — and
 * it is the right one for the marks, because it can be answered for every field
 * on screen before anyone clicks. What it cannot answer is anything that
 * depends on the value: it returns `unknown` for rich text and for a union
 * value that does not carry its discriminator, and `RestoreChrome` OFFERS an
 * `unknown` field rather than refusing it. So without this a rich text value
 * from a commit whose node format has since changed goes straight into a
 * `replace`, and the first thing to notice is the validation worker, after the
 * patch exists.
 *
 * The rule the design settled on is "refuse type-incompatible, allow validation
 * errors": a value that cannot BE this field is refused, and one that merely
 * breaks a rule about its content is staged and then held at publish by the
 * gate that already exists. Refusing the second would make putting an old value
 * back stricter than typing the same value in.
 *
 * ## Why it takes two calls
 *
 * `ValidationError.typeError` is the flag for "the shape is wrong", but core
 * does not set it on every shape failure that `executeValidate` reports.
 * Measured, not assumed:
 *
 * | value → target            | `executeAssert` | `executeValidate`   |
 * | ------------------------- | --------------- | ------------------- |
 * | `"twelve"` → `number()`   | `typeError`     | error, NO flag      |
 * | `{title}` → `{title,body}`| `typeError`     | error, NO flag      |
 * | `"..."` → `richtext()`    | `typeError`     | `typeError`         |
 * | `{x}` → discriminated union | `typeError`   | `typeError`         |
 * | `"a"` → `string().minLength(2)` | passes    | error, NO flag      |
 *
 * So filtering `executeValidate` on the flag alone would let a string into a
 * number field. `executeAssert` is the reliable root type check — it is
 * documented as exactly that — but it does NOT recurse, so it cannot see a
 * nested field. Together they cover the cases that matter here, and the
 * `minLength` row is the one that must keep passing.
 *
 * ## What is still not caught, and why that is all right
 *
 * A NESTED type mismatch that core does not flag — `{n: "twelve"}` into
 * `{n: number()}` — passes both. Reaching it means the picked value's own
 * schema had a string where the target has a number, which is a
 * schema-against-schema difference, and that is precisely what
 * `checkCompatibility` refuses before the click. The value-level gap opens only
 * where `checkCompatibility` answers `unknown`, and both of those cases — rich
 * text and an undiscriminated union — are flagged in the table above.
 *
 * Pure, and asked of the TARGET's schema with the picked value as its source:
 * the whole module is not needed to answer a question about one field, and
 * building the patched module first would mean applying the patch to decide
 * whether the patch may be applied.
 */
export function structuralErrorsOfRestore(
  targetSchema: SerializedSchema,
  value: JSONValue,
): ValidationError[] {
  // A root path: the value IS the whole of what is being checked, so every
  // error comes back keyed relative to it.
  const at = "/" as SourcePath;
  let schema;
  try {
    schema = deserializeSchema(targetSchema);
  } catch (err) {
    /*
     * A schema this Val cannot deserialize is a refusal, not a crash.
     *
     * Same family as `schema-unreadable` on the pane: something about the
     * target is not understood, and staging a write into it on that basis is
     * the one outcome that must not happen.
     */
    return [
      {
        message:
          err instanceof Error
            ? `This field's schema could not be read: ${err.message}`
            : "This field's schema could not be read.",
        schemaError: true,
      },
    ];
  }
  const asserted = schema["executeAssert"](at, value);
  if (!asserted.success) {
    return Object.values(asserted.errors).flat();
  }
  const errors = schema["executeValidate"](at, value as SelectorSource);
  if (errors === false) {
    return [];
  }
  return Object.values(errors)
    .flat()
    .filter((error) => error.typeError === true || error.schemaError === true);
}

/** What to show when the gate refuses. One line, naming the first reason. */
export function explainStructuralErrors(errors: ValidationError[]): string {
  const first = errors[0];
  if (!first) {
    return "This value cannot be restored here.";
  }
  const rest = errors.length - 1;
  return rest > 0 ? `${first.message} (and ${rest} more)` : first.message;
}

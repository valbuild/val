import type { Json, JsonObject, SerializedSchema } from "@valbuild/core";

/**
 * Can this value, taken from one schema, be written into another?
 *
 * The question restore asks, and it is NOT the question validation asks.
 * Validation checks a value against the schema it belongs to. This compares two
 * schemas — the one a value was stored under and the one it is being written
 * into — because a restore moves a value across a schema change, and possibly
 * across paths.
 *
 * Three answers, not two. `unknown` is where the comparison genuinely cannot
 * decide, and it exists so that an editor is told "we are not sure" rather than
 * being given a confident answer we made up. Treating unknown as compatible
 * writes values that break; treating it as incompatible blocks restores that
 * would have been fine.
 */
export type Compatibility =
  | { status: "compatible" }
  | { status: "incompatible"; reason: IncompatibleReason }
  | { status: "unknown"; message: string };

export type IncompatibleReason =
  | { kind: "type-changed"; from: string; to: string }
  | { kind: "no-matching-variant"; variants: string[] }
  | { kind: "unknown-field"; keys: string[] }
  | { kind: "missing-required"; keys: string[] }
  | { kind: "not-optional" }
  | { kind: "literal-changed"; from: string; to: string }
  | { kind: "different-module"; from: string; to: string };

const compatible: Compatibility = { status: "compatible" };

/**
 * `Array.isArray` cannot narrow `JsonArray` out of `Json`, because it is
 * `readonly Json[]` — so the check that reads naturally does not type. This
 * predicate is that check, said once.
 */
function isJsonObject(value: Json): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function incompatible(reason: IncompatibleReason): Compatibility {
  return { status: "incompatible", reason };
}

/**
 * "an object", "a string".
 *
 * Schema type names are data — `object`, `array`, `image` — so an interpolated
 * "a" is wrong for three of them, in a sentence shown to editors the moment a
 * restore is refused.
 */
function withArticle(type: string): string {
  return /^[aeiou]/i.test(type) ? `an ${type}` : `a ${type}`;
}

/**
 * A sentence an editor can act on, for the popup that explains a refusal.
 *
 * Kept beside the reasons rather than in the UI so that adding a reason without
 * wording for it is a type error rather than a blank dialog.
 */
export function explainIncompatible(reason: IncompatibleReason): string {
  switch (reason.kind) {
    case "type-changed":
      return `This was ${withArticle(reason.from)} and the field here is ${withArticle(reason.to)}.`;
    case "no-matching-variant":
      return `This does not match any of the shapes allowed here: ${reason.variants.join(", ")}.`;
    case "unknown-field":
      return `The old value has ${reason.keys.length === 1 ? "a field" : "fields"} that no longer exist here: ${reason.keys.join(", ")}.`;
    case "missing-required":
      return `The field here needs ${reason.keys.join(", ")}, which the old value does not have.`;
    case "not-optional":
      return "The old value was empty, and this field cannot be empty.";
    case "literal-changed":
      return `This has to be exactly "${reason.to}", and the old value was "${reason.from}".`;
    case "different-module":
      return `This points into ${reason.to}, and the old value pointed into ${reason.from}.`;
  }
}

/**
 * The variant of a union that a value actually is.
 *
 * `undefined` when the value does not identify itself — which is a real answer,
 * not a failure: it is what makes the caller return `unknown` rather than guess.
 */
function variantOf(
  schema: SerializedSchema,
  value: Json,
): SerializedSchema | undefined {
  if (schema.type !== "union") {
    return undefined;
  }
  // String union: the value IS the discriminator.
  if (typeof schema.key !== "string") {
    if (typeof value !== "string") {
      return undefined;
    }
    return schema.items.find(
      (item) => item.type === "literal" && item.value === value,
    );
  }
  // Object union: the discriminator is a literal at `key`.
  const discriminator = schema.key;
  if (!isJsonObject(value)) {
    return undefined;
  }
  const tag = value[discriminator];
  if (typeof tag !== "string") {
    return undefined;
  }
  return schema.items.find((item) => {
    if (item.type !== "object") {
      return false;
    }
    const keySchema = item.items[discriminator];
    return keySchema?.type === "literal" && keySchema.value === tag;
  });
}

function describeVariant(schema: SerializedSchema, key: string): string {
  if (schema.type === "literal") {
    return schema.value;
  }
  if (schema.type === "object") {
    const tag = schema.items[key];
    if (tag?.type === "literal") {
      return tag.value;
    }
  }
  return schema.type;
}

export function checkCompatibility(
  from: { schema: SerializedSchema; value: Json },
  to: { schema: SerializedSchema },
): Compatibility {
  // Emptiness first: a null that lands in a field which cannot be empty is a
  // break regardless of what the two schemas otherwise say.
  if (from.value === null) {
    return to.schema.opt ? compatible : incompatible({ kind: "not-optional" });
  }

  // A changed union is not itself disqualifying. What matters is whether the
  // variant being restored still has somewhere to go — comparing the unions
  // wholesale would refuse a restore that is perfectly safe.
  if (to.schema.type === "union") {
    const key = typeof to.schema.key === "string" ? to.schema.key : "";
    for (const variant of to.schema.items) {
      if (
        checkCompatibility(from, { schema: variant }).status === "compatible"
      ) {
        return compatible;
      }
    }
    return incompatible({
      kind: "no-matching-variant",
      variants: to.schema.items.map((item) => describeVariant(item, key)),
    });
  }

  // Coming FROM a union into something that is not one: only the variant this
  // value actually is matters, so narrow before comparing.
  if (from.schema.type === "union") {
    const variant = variantOf(from.schema, from.value);
    if (variant === undefined) {
      return {
        status: "unknown",
        message:
          "The old value does not say which shape it is, so we cannot tell whether it fits here.",
      };
    }
    return checkCompatibility({ schema: variant, value: from.value }, to);
  }

  if (from.schema.type !== to.schema.type) {
    return incompatible({
      kind: "type-changed",
      from: from.schema.type,
      to: to.schema.type,
    });
  }

  switch (to.schema.type) {
    case "literal": {
      const fromValue =
        from.schema.type === "literal" ? from.schema.value : String(from.value);
      return fromValue === to.schema.value
        ? compatible
        : incompatible({
            kind: "literal-changed",
            from: fromValue,
            to: to.schema.value,
          });
    }

    case "object": {
      if (from.schema.type !== "object" || !isJsonObject(from.value)) {
        return {
          status: "unknown",
          message: "The old value is not shaped like an object.",
        };
      }
      const fromValue = from.value;
      const target = to.schema.items;
      const source = from.schema.items;

      // Keys the old value carries that the field no longer has. Writing them
      // would put data into a schema with nowhere to hold it.
      const extra = Object.keys(source).filter((key) => !(key in target));
      if (extra.length > 0) {
        return incompatible({ kind: "unknown-field", keys: extra });
      }

      // Keys the field requires that the old value cannot supply.
      const missing = Object.keys(target).filter(
        (key) => !target[key].opt && !(key in source),
      );
      if (missing.length > 0) {
        return incompatible({ kind: "missing-required", keys: missing });
      }

      let unknown: Compatibility | null = null;
      for (const [key, targetItem] of Object.entries(target)) {
        const sourceItem = source[key];
        if (sourceItem === undefined) {
          continue; // optional and absent — already allowed above
        }
        const res = checkCompatibility(
          { schema: sourceItem, value: fromValue[key] ?? null },
          { schema: targetItem },
        );
        if (res.status === "incompatible") {
          return res;
        }
        if (res.status === "unknown" && unknown === null) {
          unknown = res;
        }
      }
      return unknown ?? compatible;
    }

    case "array": {
      if (from.schema.type !== "array" || !Array.isArray(from.value)) {
        return {
          status: "unknown",
          message: "The old value is not a list.",
        };
      }
      // An empty list has nothing to probe the item schema with. The item
      // TYPES still have to agree, and that much can be decided without a
      // value - so decide it rather than passing an empty list as proof.
      if (from.value.length === 0) {
        return from.schema.item.type === to.schema.item.type
          ? compatible
          : incompatible({
              kind: "type-changed",
              from: from.schema.item.type,
              to: to.schema.item.type,
            });
      }
      let unknown: Compatibility | null = null;
      for (const item of from.value) {
        const res = checkCompatibility(
          { schema: from.schema.item, value: item },
          { schema: to.schema.item },
        );
        if (res.status === "incompatible") {
          return res;
        }
        if (res.status === "unknown" && unknown === null) {
          unknown = res;
        }
      }
      return unknown ?? compatible;
    }

    case "record": {
      if (from.schema.type !== "record" || !isJsonObject(from.value)) {
        return { status: "unknown", message: "The old value is not a record." };
      }
      let unknown: Compatibility | null = null;
      for (const entry of Object.values(from.value)) {
        const res = checkCompatibility(
          { schema: from.schema.item, value: entry ?? null },
          { schema: to.schema.item },
        );
        if (res.status === "incompatible") {
          return res;
        }
        if (res.status === "unknown" && unknown === null) {
          unknown = res;
        }
      }
      return unknown ?? compatible;
    }

    case "keyOf": {
      // A key is only meaningful against the module it indexes.
      if (from.schema.type !== "keyOf") {
        return compatible;
      }
      return from.schema.path === to.schema.path
        ? compatible
        : incompatible({
            kind: "different-module",
            from: from.schema.path,
            to: to.schema.path,
          });
    }

    case "richtext": {
      // The options decide which nodes are legal, and comparing them properly
      // means comparing node trees against them. Not yet done, and saying so is
      // better than a confident answer we cannot back.
      return {
        status: "unknown",
        message:
          "Rich text can be restored, but we cannot yet confirm every mark and block is still allowed here.",
      };
    }

    default:
      // Primitives and media: same type is the whole test. Constraints
      // (maxLength, accept, …) are validated on write, which reports them
      // better than a schema comparison could.
      return compatible;
  }
}

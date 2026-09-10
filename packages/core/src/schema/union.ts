import { Schema } from ".";
import { SelectorSource } from "../selector/index";
import {
  DiscriminatedUnionItem,
  DiscriminatedUnionItems,
  DiscriminatedUnionSchema,
  DiscriminatedUnionSourceOf,
  SerializedDiscriminatedUnionSchema,
} from "./discriminatedUnion";
import { EnumSchema, SerializedEnumSchema } from "./enum";
import { LiteralSchema } from "./literal";

/**
 * @deprecated Use {@link SerializedDiscriminatedUnionSchema} or
 * {@link SerializedEnumSchema}. A serialized union is now one or the other,
 * distinguished by `type` rather than by the shape of `key`.
 */
export type SerializedUnionSchema =
  | SerializedDiscriminatedUnionSchema
  | SerializedEnumSchema;

/** @deprecated Use {@link SerializedEnumSchema}. */
export type SerializedStringUnionSchema = SerializedEnumSchema;

/** @deprecated Use {@link SerializedDiscriminatedUnionSchema}. */
export type SerializedObjectUnionSchema = SerializedDiscriminatedUnionSchema;

/**
 * @deprecated There is no single union schema class any more: name
 * {@link DiscriminatedUnionSchema} or {@link EnumSchema}. The type parameters
 * are kept so existing annotations still compile, but only `Src` is used.
 */
export type UnionSchema<
  _Key = unknown,
  _T = unknown,
  Src extends SelectorSource = SelectorSource,
> = Schema<Src>;

/**
 * The value type of a list of literal schemas — how `s.union` typed a union of
 * literals. Inferred from `Schema<infer S>` rather than `LiteralSchema<infer S>`
 * because a `LiteralSchema` is invariant in its source (its custom validate
 * functions put it in a parameter position), so `LiteralSchema<"a">` is not
 * assignable to `LiteralSchema<"a" | "b">`.
 */
type EnumSourceOf<T extends Schema<string>[]> = T extends Schema<infer S>[]
  ? S extends string
    ? S
    : never
  : never;

/**
 * @deprecated Use `s.discriminatedUnion(key, ...objects)` for a tagged union of
 * objects, or `s.enum("a", "b")` for one of a fixed set of strings.
 *
 * @example // was: s.union("type", s.object({ type: s.literal("a") }), ...)
 * s.discriminatedUnion("type", s.object({ type: s.literal("a") }), ...)
 *
 * @example // was: s.union(s.literal("a"), s.literal("b"))
 * s.enum("a", "b")
 */
export function union<
  Key extends string,
  T extends DiscriminatedUnionItems<Key>,
>(
  key: Key,
  ...objects: T
): DiscriminatedUnionSchema<Key, T, DiscriminatedUnionSourceOf<Key, T>>;
export function union<T extends Schema<string>[]>(
  ...literals: T
): EnumSchema<EnumSourceOf<T>>;
export function union(
  keyOrFirstLiteral: string | LiteralSchema<string>,
  ...rest: unknown[]
): Schema<SelectorSource> {
  if (typeof keyOrFirstLiteral === "string") {
    return new DiscriminatedUnionSchema(
      keyOrFirstLiteral,
      rest as DiscriminatedUnionItem<string>[],
    );
  }
  // A literal union is an enum: the values ARE the schema, so the literals are
  // flattened into them. `key` was only ever the first member.
  const literals = [keyOrFirstLiteral, ...rest];
  const values: string[] = [];
  for (const literal of literals) {
    if (!(literal instanceof LiteralSchema)) {
      throw new Error(
        `s.union: expected either a string key followed by object schemas, or literal schemas. Got: ${JSON.stringify(
          literal,
        )}`,
      );
    }
    values.push(literal["value"]);
  }
  return new EnumSchema<string>(values);
}

import * as lens from "../lens";
import { Source } from "../Source";
import { ArraySelector, newArraySelector } from "./array";
import { InObject, ObjectSchema, SchemaObject } from "../schema/object";
import { PrimitiveSelector } from "./primitive";
import { Schema } from "../schema/Schema";
import { StringSchema } from "../schema/string";
import { ArraySchema } from "../schema/array";
import { newObjectSelector, ObjectSelector } from "./object";
import { Selector } from "./selector";

export type SelectorOf<
  Src,
  T extends Schema<Source, unknown>
> = T extends ObjectSchema<infer U>
  ? ObjectSelector<Src, U>
  : T extends ArraySchema<infer U>
  ? ArraySelector<Src, U>
  : T extends Schema<Source, infer U>
  ? Selector<Src, U>
  : Selector<Src, unknown>;

export function getSelector<
  Src,
  In extends Source,
  Out,
  T extends Schema<In, Out>
>(fromSrc: lens.Lens<Src, In>, schema: T): SelectorOf<Src, T> {
  if (schema instanceof ObjectSchema) {
    return newObjectSelector(
      fromSrc as lens.Lens<Src, InObject<SchemaObject>>,
      schema.schema
    ) as unknown as SelectorOf<Src, T>;
  } else if (schema instanceof ArraySchema) {
    return newArraySelector(
      fromSrc as lens.Lens<Src, Source[]>,
      schema.schema
    ) as unknown as SelectorOf<Src, T>;
  } else if (schema instanceof StringSchema) {
    return new PrimitiveSelector(fromSrc) as unknown as SelectorOf<Src, T>;
  } else {
    throw Error("Invalid schema type");
  }
}

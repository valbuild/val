import { Schema, SelectorOfSchema } from ".";
import { ValRouter } from "../router";
import { SelectorSource } from "../selector";
import { RecordSchema } from "./record";
import { string } from "./string";

export function router<
  T extends Schema<SelectorSource>,
  Src extends Record<string, SelectorOfSchema<T>>,
>(router: ValRouter, item: T): RecordSchema<T, Schema<string>, Src> {
  const keySchema = string();
  const recordSchema = new RecordSchema<T, Schema<string>, Src>(
    item,
    false,
    [],
    router,
    keySchema,
  );
  return recordSchema;
}

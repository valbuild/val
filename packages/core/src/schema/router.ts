import { Schema, SelectorOfSchema } from ".";
import { ValRouter } from "../router";
import { SelectorSource } from "../selector";
import { RecordSchema } from "./record";
import { string } from "./string";

export function router<
  K extends Schema<string>,
  T extends Schema<SelectorSource>,
>(
  router: ValRouter,
  key: K,
  item: T,
): RecordSchema<T, K, Record<SelectorOfSchema<K>, SelectorOfSchema<T>>>;

export function router<T extends Schema<SelectorSource>>(
  router: ValRouter,
  item: T,
): RecordSchema<T, Schema<string>, Record<string, SelectorOfSchema<T>>>;

export function router<
  K extends Schema<string>,
  T extends Schema<SelectorSource>,
>(
  router: ValRouter,
  keyOrItem: K | T,
  maybeItem?: T,
): RecordSchema<T, K, Record<SelectorOfSchema<K>, SelectorOfSchema<T>>> {
  if (maybeItem) {
    return new RecordSchema(maybeItem, false, [], router, keyOrItem as K);
  }
  return new RecordSchema(keyOrItem as T, false, [], router, string());
}

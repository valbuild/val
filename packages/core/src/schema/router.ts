import { Schema, SelectorOfSchema } from ".";
import { ValRouter } from "../router";
import { SelectorSource } from "../selector";
import { RecordSchema } from "./record";
import { string } from "./string";

/**
 * A schema for each of a route's parameters, by the name the route file gives
 * it: `$slug` / `[slug]` is `slug`, `{-$locale}` is `locale`.
 */
export type RouteParamSchemas = {
  readonly [name: string]: Schema<string | null>;
};

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
  params: RouteParamSchemas,
  item: T,
): RecordSchema<T, Schema<string>, Record<string, SelectorOfSchema<T>>>;

export function router<T extends Schema<SelectorSource>>(
  router: ValRouter,
  item: T,
): RecordSchema<T, Schema<string>, Record<string, SelectorOfSchema<T>>>;

export function router<
  K extends Schema<string>,
  T extends Schema<SelectorSource>,
>(
  router: ValRouter,
  keyOrItem: K | T | RouteParamSchemas,
  maybeItem?: T,
): RecordSchema<T, K, Record<SelectorOfSchema<K>, SelectorOfSchema<T>>> {
  if (maybeItem) {
    if (keyOrItem instanceof Schema) {
      return new RecordSchema(maybeItem, false, [], router, keyOrItem as K);
    }
    return new RecordSchema(
      maybeItem,
      false,
      [],
      router,
      string(),
      undefined,
      false,
      false,
      undefined,
      false,
      null,
      null,
      null,
      { ...keyOrItem },
    );
  }
  return new RecordSchema(keyOrItem as T, false, [], router, string());
}

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
  params: RouteParamSchemas,
  item: T,
): RecordSchema<T, K, Record<SelectorOfSchema<K>, SelectorOfSchema<T>>>;

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
  first: K | T | RouteParamSchemas,
  second?: T | RouteParamSchemas,
  third?: T,
): RecordSchema<T, K, Record<SelectorOfSchema<K>, SelectorOfSchema<T>>> {
  // Four arguments: the key's own schema AND one per route parameter. The key
  // schema describes the whole URL (what the "New page" box says to type);
  // the parameter schemas check the parts of it.
  if (third) {
    if (!(first instanceof Schema) || second instanceof Schema || !second) {
      throw new Error(
        "s.router(router, key, params, item): the key must be a schema and the params an object of schemas",
      );
    }
    return withRouteParams(router, first as K, second, third);
  }
  if (second) {
    if (second instanceof Schema) {
      if (first instanceof Schema) {
        return new RecordSchema(second, false, [], router, first as K);
      }
      return withRouteParams(router, string(), first, second);
    }
    throw new Error(
      "s.router(router, …, item): the last argument must be a schema",
    );
  }
  return new RecordSchema(first as T, false, [], router, string());
}

function withRouteParams<
  K extends Schema<string>,
  T extends Schema<SelectorSource>,
>(
  router: ValRouter,
  key: K,
  params: RouteParamSchemas,
  item: T,
): RecordSchema<T, K, Record<SelectorOfSchema<K>, SelectorOfSchema<T>>> {
  return new RecordSchema(
    item,
    false,
    [],
    router,
    key,
    undefined,
    false,
    false,
    undefined,
    false,
    null,
    null,
    null,
    { ...params },
  );
}

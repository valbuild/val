import { Schema, SelectorOfSchema } from ".";
import { ValRouter } from "../router";
import { SelectorSource } from "../selector";
import { RecordSchema } from "./record";
import { string } from "./string";

/**
 * Utility function to create a router record.
 * This is a shorthand for `s.record(item).router(router)`.
 *
 * @example
 * ```typescript
 * // Instead of:
 * s.record(schema).router(nextAppRouter)
 *
 * // You can write:
 * s.router(nextAppRouter, schema)
 * ```
 *
 * @param router - The router configuration (e.g., nextAppRouter)
 * @param item - The schema for each route item
 * @returns A RecordSchema configured as a router
 */
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

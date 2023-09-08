import {
  Internal,
  Json,
  JsonArray,
  ModulePath,
  SerializedModule,
  Source,
  SourcePath,
} from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import { JsonObject } from "@valbuild/core";

export type QueryObject = { [key: string]: QueryObject } | true;

export type QueryError = {
  fallbackSource: Json;
  messages: string[];
  queryObject: QueryObject;
};
export function query(
  valModules: SerializedModule[],
  queryObject: Record<string, QueryObject>
): Record<string, result.Result<Json, QueryError>> {
  function it(
    source: Json,
    queryObject: QueryObject
  ): result.Result<Json, QueryError> {
    if (queryObject === true) {
      return result.ok(source);
    }
    if (typeof source === "object") {
      if (source === null) {
        return result.ok(source);
      }
      if (Array.isArray(source)) {
        const errors = [];
        const res = [];
        for (const el of source) {
          const curr = it(el, queryObject);
          if (result.isErr(curr)) {
            errors.push(...curr.error.messages);
            res.push(curr.error.fallbackSource);
          } else {
            res.push(curr.value);
          }
        }
        if (errors.length > 0) {
          return result.err({
            fallbackSource: res,
            messages: errors,
            queryObject,
          });
        }
        return result.ok(res);
      }
      const sourceObject = source as JsonObject; // JsonArray is readonly array which is not covered by the isArray type guard

      const errors = [];
      const res: Record<string, Json> = {};
      for (const [key, subQueryObject] of Object.entries(queryObject)) {
        if (sourceObject[key] === undefined) {
          errors.push(
            `Could not query key: "${key}". Available keys: ${Object.keys(
              sourceObject
            )
              .map((k) => `"${k}"`)
              .join(", ")}`
          );
        } else {
          const curr = it(sourceObject[key], subQueryObject);
          if (result.isErr(curr)) {
            errors.push(...curr.error.messages);
            res[key] = curr.error.fallbackSource;
          } else {
            res[key] = curr.value;
          }
        }
      }
      if (errors.length > 0) {
        return result.err({
          fallbackSource: res,
          messages: errors,
          queryObject,
        });
      }
      return result.ok(res);
    }
    return result.err({
      fallbackSource: source,
      messages: [
        `Cannot execute this query on source of this type : '${typeof source}'`,
      ],
      queryObject,
    });
  }

  const res: Record<string, result.Result<Json, QueryError>> = {};
  for (const [modulePath, selectedPaths] of Object.entries(queryObject)) {
    const module = valModules.find((m) => m.path === modulePath);
    if (!module) {
      res[modulePath] = result.err({
        fallbackSource: null,
        messages: [`Could not find module '${modulePath}'`],
        queryObject,
      });
    } else {
      res[modulePath] = it(module.source, selectedPaths);
    }
  }
  return res;
}

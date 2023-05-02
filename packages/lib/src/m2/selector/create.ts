// TODO: cleanup the module dependency cycles, rename index.ts -> Selector.ts and create.ts -> index.ts?

import { Selector, VAL } from ".";
import { Schema } from "../schema";
import { ArraySchema } from "../schema/array";
import { NumberSchema } from "../schema/number";
import { ObjectSchema } from "../schema/object";
import { StringSchema } from "../schema/string";
import { SourceArray, Source, SourceObject } from "../Source";
import { SourcePath } from "../val";
import { ArraySelector } from "./array";
import { ObjectSelector } from "./object";

export function createArraySelector<T extends SourceArray>(
  sourcePath: SourcePath,
  schema: ArraySchema<Schema<T[number]>>,
  source: T
): Selector<T> {
  const arraySelector = new ArraySelector<T>(sourcePath, schema, source);
  return new Proxy(arraySelector, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && !isNaN(Number(prop))) {
        return createSelector(
          `${sourcePath}.${prop}` as SourcePath,
          schema.item,
          source[Number(prop)]
        );
      } else if (prop === VAL) {
        return () => arraySelector[VAL]().val;
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as Selector<T>;
}

export function createObjectSelector<T extends SourceObject>(
  sourcePath: SourcePath,
  schema: ObjectSchema<{
    [key: string]: Schema<Source>;
  }>,
  source: T
): Selector<T> {
  const objectSelector = new ObjectSelector<T>(sourcePath, schema, source);
  return new Proxy(objectSelector, {
    get(target, prop, receiver) {
      if (typeof prop === "string") {
        return createSelector(
          `${sourcePath}.${prop}` as SourcePath,
          schema.props[prop],
          source[prop]
        );
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as Selector<T>;
}

export function createSelector<T extends Source>(
  sourcePath: SourcePath,
  schema: Schema<T>,
  source: T
): Selector<T> {
  if (schema instanceof ArraySchema) {
    if (!Array.isArray(source)) {
      throw Error(`Expected array: ${JSON.stringify(source)}`);
    }
    return createArraySelector(
      sourcePath,
      schema,
      source as unknown as SourceArray
    ) as Selector<T>;
  } else if (schema instanceof ObjectSchema) {
    if (typeof source !== "object") {
      throw Error(`Expected object: ${JSON.stringify(source)}`);
    }
    return createObjectSelector(
      sourcePath,
      schema,
      source as unknown as SourceObject
    ) as Selector<T>;
  } else if (schema instanceof StringSchema) {
    if (typeof source !== "string") {
      throw Error(`Expected string: ${JSON.stringify(source)}`);
    }
    return {
      [VAL]() {
        return {
          valPath: sourcePath,
          val: source,
        };
      },
    } as Selector<T>;
  } else if (schema instanceof NumberSchema) {
    if (typeof source !== "number") {
      throw Error(`Expected number: ${JSON.stringify(source)}`);
    }
    return {
      [VAL]() {
        return {
          valPath: sourcePath,
          val: source,
        };
      },
    } as Selector<T>;
  }
  throw Error("schema is not of an instance we know of");
}

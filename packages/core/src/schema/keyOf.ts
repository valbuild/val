/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema, SourceObject } from "..";
import { ValModuleBrand } from "../module";
import { GenericSelector, GetSchema } from "../selector";
import { SourceArray } from "../source";
import { SourcePath, getValPath } from "../val";
import { ValidationErrors } from "./validation/ValidationError";

export type SerializedKeyOfSchema = {
  type: "keyOf";
  selector: SourcePath;
  opt: boolean;
};

type KeyOfSelector<Sel extends GenericSelector<SourceArray | SourceObject>> =
  Sel extends GenericSelector<infer S>
    ? // TODO: remove any:
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      S extends readonly any[]
      ? number
      : S extends SourceObject
      ? keyof S
      : // TODO: remove any:
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      S extends Record<string, any>
      ? string
      : never
    : never;

export class KeyOfSchema<
  Sel extends GenericSelector<SourceArray | SourceObject>
> extends Schema<KeyOfSelector<Sel>> {
  constructor(readonly selector: Sel, readonly opt: boolean = false) {
    super();
  }
  validate(path: SourcePath, src: KeyOfSelector<Sel>): ValidationErrors {
    if (this.opt && (src === null || src === undefined)) {
      return false;
    }
    const schema = this.selector[GetSchema];
    if (!schema) {
      return {
        [path]: [
          {
            message: `Schema not found for module. keyOf must be used with a Val Module`,
          },
        ],
      };
    }
    const serializedSchema = schema.serialize();

    if (
      !(
        serializedSchema.type === "array" ||
        serializedSchema.type === "object" ||
        serializedSchema.type === "record"
      )
    ) {
      return {
        [path]: [
          {
            message: `Schema in keyOf must be an 'array', 'object' or 'record'. Found '${serializedSchema.type}'`,
          },
        ],
      };
    }
    if (serializedSchema.opt && (src === null || src === undefined)) {
      return false;
    }
    if (serializedSchema.type === "array" && typeof src !== "number") {
      return {
        [path]: [
          {
            message: "Type of value in keyof (array) must be 'number'",
          },
        ],
      };
    }
    if (serializedSchema.type === "record" && typeof src !== "string") {
      return {
        [path]: [
          {
            message: "Type of value in keyof (record) must be 'string'",
          },
        ],
      };
    }
    if (serializedSchema.type === "object") {
      const keys = Object.keys(serializedSchema.items);
      if (!keys.includes(src as string)) {
        return {
          [path]: [
            {
              message: `Value of keyOf (object) must be: ${keys.join(
                ", "
              )}. Found: ${src}`,
            },
          ],
        };
      }
    }
    return false;
  }

  assert(src: KeyOfSelector<Sel>): boolean {
    if (this.opt && (src === null || src === undefined)) {
      return true;
    }
    const schema = this.selector[GetSchema];
    if (!schema) {
      return false;
    }
    const serializedSchema = schema.serialize();

    if (
      !(
        serializedSchema.type === "array" ||
        serializedSchema.type === "object" ||
        serializedSchema.type === "record"
      )
    ) {
      return false;
    }
    if (serializedSchema.opt && (src === null || src === undefined)) {
      return true;
    }
    if (serializedSchema.type === "array" && typeof src !== "number") {
      return false;
    }
    if (serializedSchema.type === "record" && typeof src !== "string") {
      return false;
    }
    if (serializedSchema.type === "object") {
      const keys = Object.keys(serializedSchema.items);
      if (!keys.includes(src as string)) {
        return false;
      }
    }
    return true;
  }

  optional(): Schema<KeyOfSelector<Sel> | null> {
    return new KeyOfSchema(this.selector, true);
  }

  serialize(): SerializedSchema {
    const path = getValPath(this.selector);
    if (!path) {
      throw new Error(
        "Cannot serialize oneOf schema with empty selector. keyOf must be used with a Val Module."
      );
    }
    return {
      type: "keyOf",
      selector: path,
      opt: this.opt,
    };
  }
}

export const keyOf = <
  Src extends GenericSelector<SourceArray | SourceObject> & ValModuleBrand // ValModuleBrand enforces call site to pass in a val module - selectors are not allowed. The reason is that this should make it easier to patch. We might be able to relax this constraint in the future
>(
  valModule: Src
): Schema<KeyOfSelector<Src>> => {
  return new KeyOfSchema(valModule);
};

/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { createValPathOfItem } from "../selector/SelectorProxy";
import { SelectorSource } from "../selector/index";
import { SourceObject } from "../source";
import { SourcePath } from "../val";
import { ValidationErrors } from "./validation/ValidationError";

export type SerializedUnionSchema = {
  type: "union";
  key?: string;
  items: SerializedSchema[];
  opt: boolean;
};

type SourceOf<
  Key extends string | Schema<string>,
  T extends Schema<
    Key extends string
      ? SourceObject & { [k in Key]: string }
      : Key extends Schema<string>
      ? string
      : unknown
  >[]
> = T extends Schema<infer S>[]
  ? S extends SelectorSource
    ? S | (Key extends Schema<infer K> ? K : never)
    : never
  : never;

export class UnionSchema<
  Key extends string | Schema<string>,
  T extends Schema<
    Key extends string
      ? SourceObject & { [k in Key]: string }
      : Key extends Schema<string>
      ? string
      : unknown
  >[]
> extends Schema<SourceOf<Key, T>> {
  validate(path: SourcePath, src: SourceOf<Key, T>): ValidationErrors {
    let errors: ValidationErrors = false;

    if (this.opt && (src === null || src === undefined)) {
      // TODO: src should never be undefined
      return false;
    }

    if (!this.key) {
      return {
        [path]: [
          {
            message: `Missing required first argument in union`,
          },
        ],
      };
    }

    if (typeof this.key === "string") {
    } else {
      if (!Array.isArray(this.items)) {
        return {
          [path]: [{ message: `Internal error: union items is not an array` }],
        };

        const subPath = createValPathOfItem(path, 0);
        if (!subPath) {
        }
      }
      this.key.validate(createValPathOfItem(path, 0), src);
      for (const [index, item] of Array.from(this.items.entries())) {
        const subPath = createValPathOfItem(path, index + 1);
        if (!subPath) {
          errors = this.appendValidationError(
            errors,
            path,
            `Internal error: could not create path at ${
              !path && typeof path === "string" ? "<empty string>" : path
            } at index ${index}`, // Should! never happen
            src
          );
        } else {
          const result = item.validate(subPath, src[index]);
          if (result !== false) {
            if (errors === false) errors = {};
            errors = {
              ...result,
            };
          }
        }
      }
    }
    return errors;
  }
  assert(src: SourceOf<Key, T>): boolean {
    return true;
  }
  optional(): Schema<SourceOf<Key, T> | null> {
    return new UnionSchema(this.key, this.items, true);
  }
  serialize(): SerializedSchema {
    if (typeof this.key === "string") {
      return {
        type: "union",
        key: this.key,
        items: this.items.map((o) => o.serialize()),
        opt: this.opt,
      };
    }
    return {
      type: "union",
      items: this.items.map((o) => o.serialize()),
      opt: this.opt,
    };
  }

  constructor(
    readonly key: Key,
    readonly items: T,
    readonly opt: boolean = false
  ) {
    super();
  }
}

export const union = <
  Key extends string | Schema<string>,
  T extends Schema<
    Key extends string
      ? SourceObject & { [k in Key]: string }
      : Key extends Schema<string>
      ? string
      : unknown
  >[]
>(
  key: Key,
  ...objects: T
): Schema<SourceOf<Key, T>> => {
  return new UnionSchema(key, objects);
};

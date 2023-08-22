/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { VAL_EXTENSION } from "../source";
import { RichTextSource } from "../source/richtext";
import { SourcePath } from "../val";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";

export type SerializedRichTextSchema = {
  type: "richtext";
  opt: boolean;
};

export class RichTextSchema<
  Src extends RichTextSource | null
> extends Schema<Src> {
  validate(path: SourcePath, src: Src): ValidationErrors {
    if (this.opt && (src === null || src === undefined)) {
      return false;
    }
    if (src === null || src === undefined) {
      return {
        [path]: [
          { message: `Expected non-nullable got '${src}'` } as ValidationError,
        ],
      } as ValidationErrors;
    }

    if (typeof src !== "object" && !Array.isArray(src)) {
      return {
        [path]: [
          {
            message: `Expected 'object' (that is not of an array) or 'string', got '${typeof src}'`,
            value: src,
          } as ValidationError,
        ],
      } as ValidationErrors;
    }

    if (src[VAL_EXTENSION] !== "richtext") {
      return {
        [path]: [
          {
            message: `Expected _type key with value 'richtext' got '${src[VAL_EXTENSION]}'`,
            value: src,
          } as ValidationError,
        ],
      } as ValidationErrors;
    }

    if (src.type !== "root") {
      return {
        [path]: [
          {
            message: `Expected type key with value 'root' got '${src.type}'`,
            value: src,
          } as ValidationError,
        ],
      } as ValidationErrors;
    }

    if (typeof src.children !== "object" && !Array.isArray(src.children)) {
      return {
        [path]: [
          {
            message: `Expected children to be an array, but got '${src.type}'`,
            value: src,
          } as ValidationError,
        ],
      } as ValidationErrors;
    }

    return false;
  }
  assert(src: Src): boolean {
    // TODO:
    return true;
  }

  optional(): Schema<RichTextSource | null> {
    return new RichTextSchema(true);
  }
  serialize(): SerializedSchema {
    return {
      type: "richtext",
      opt: this.opt,
    };
  }
  constructor(readonly opt: boolean = false) {
    super();
  }
}

export const richtext = (): Schema<RichTextSource> => {
  return new RichTextSchema();
};

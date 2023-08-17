/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { SourcePath } from "../val";
import { ValidationError } from "./validation/ValidationError";

type StringOptions = {
  maxLength?: number;
  minLength?: number;
};

export type SerializedStringSchema = {
  type: "string";
  options?: StringOptions;
  opt: boolean;
};

export class StringSchema<Src extends string | null> extends Schema<Src> {
  constructor(readonly options?: StringOptions, readonly opt: boolean = false) {
    super();
  }

  validate(path: SourcePath, src: Src): ValidationError {
    if (this.opt && (src === null || src === undefined)) {
      return false;
    }
    if (typeof src !== "string") {
      return {
        [path]: [
          { message: `Expected 'string', got '${typeof src}'`, value: src },
        ],
      } as ValidationError;
    }
    return false;
  }

  assert(src: Src): boolean {
    if (this.opt && (src === null || src === undefined)) {
      return true;
    }
    return typeof src === "string";
  }

  optional(): Schema<Src | null> {
    return new StringSchema<Src | null>(this.options, true);
  }

  serialize(): SerializedSchema {
    return {
      type: "string",
      options: this.options,
      opt: this.opt,
    };
  }
}

export const string = <T extends string>(
  options?: StringOptions
): Schema<T> => {
  return new StringSchema(options);
};

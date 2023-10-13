/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { SourcePath } from "../val";
import { ValidationErrors } from "./validation/ValidationError";

type StringOptions = {
  maxLength?: number;
  minLength?: number;
};

export type SerializedStringSchema = {
  type: "string";
  options?: StringOptions;
  opt: boolean;
  raw: boolean;
};

export class StringSchema<Src extends string | null> extends Schema<Src> {
  constructor(
    readonly options?: StringOptions,
    readonly opt: boolean = false,
    readonly isRaw: boolean = false
  ) {
    super();
  }

  validate(path: SourcePath, src: Src): ValidationErrors {
    if (this.opt && (src === null || src === undefined)) {
      return false;
    }
    if (typeof src !== "string") {
      return {
        [path]: [
          { message: `Expected 'string', got '${typeof src}'`, value: src },
        ],
      } as ValidationErrors;
    }
    return false;
  }

  assert(src: Src): boolean {
    if (this.opt && (src === null || src === undefined)) {
      return true;
    }
    return typeof src === "string";
  }

  optional(): StringSchema<Src | null> {
    return new StringSchema<Src | null>(this.options, true, this.isRaw);
  }

  raw(): StringSchema<Src> {
    return new StringSchema<Src>(this.options, this.opt, true);
  }

  serialize(): SerializedSchema {
    return {
      type: "string",
      options: this.options,
      opt: this.opt,
      raw: this.isRaw,
    };
  }
}

export const string = <T extends string>(
  options?: StringOptions
): StringSchema<T> => {
  return new StringSchema(options);
};

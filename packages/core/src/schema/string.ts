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

const brand = Symbol("string");
export type RawString = string & { readonly [brand]: "raw" };

export class StringSchema<Src extends string | null> extends Schema<Src> {
  constructor(
    readonly options?: StringOptions,
    readonly opt: boolean = false,
    private readonly isRaw: boolean = false
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
    const errors = [];
    if (this.options?.maxLength && src.length > this.options.maxLength) {
      errors.push({
        message: `Expected string to be at most ${this.options.maxLength} characters long, got ${src.length}`,
        value: src,
      });
    }
    if (this.options?.minLength && src.length < this.options.minLength) {
      errors.push({
        message: `Expected string to be at least ${this.options.minLength} characters long, got ${src.length}`,
        value: src,
      });
    }
    if (errors.length > 0) {
      return {
        [path]: errors,
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

  raw(): StringSchema<Src extends null ? RawString | null : RawString> {
    return new StringSchema<Src extends null ? RawString | null : RawString>(
      this.options,
      this.opt,
      true
    );
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

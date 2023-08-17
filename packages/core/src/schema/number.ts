/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { SourcePath } from "../val";
import { ValidationError } from "./validation/ValidationError";

type NumberOptions = {
  max?: number;
  min?: number;
};

export type SerializedNumberSchema = {
  type: "number";
  options?: NumberOptions;
  opt: boolean;
};

export class NumberSchema<Src extends number | null> extends Schema<Src> {
  constructor(readonly options?: NumberOptions, readonly opt: boolean = false) {
    super();
  }
  validate(path: SourcePath, src: Src): ValidationError {
    if (this.opt && (src === null || src === undefined)) {
      return false;
    }
    if (typeof src !== "number") {
      return {
        [path]: [
          { message: `Expected 'number', got '${typeof src}'`, value: src },
        ],
      } as ValidationError;
    }
    return false;
  }

  assert(src: Src): boolean {
    if (this.opt && (src === null || src === undefined)) {
      return true;
    }
    return typeof src === "number";
  }

  optional(): Schema<Src | null> {
    return new NumberSchema<Src | null>(this.options, true);
  }
  serialize(): SerializedSchema {
    return {
      type: "number",
      options: this.options,
      opt: this.opt,
    };
  }
}

export const number = (options?: NumberOptions): Schema<number> => {
  return new NumberSchema(options);
};

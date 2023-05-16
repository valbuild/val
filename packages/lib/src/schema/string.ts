/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { SourcePath } from "../val";

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
  constructor(
    readonly options?: StringOptions,
    readonly isOptional: boolean = false
  ) {
    super();
  }

  validate(src: Src): false | Record<SourcePath, string[]> {
    throw new Error("Method not implemented.");
  }

  match(src: Src): boolean {
    if (this.isOptional && (src === null || src === undefined)) {
      return true;
    }
    return typeof src === "string";
  }

  optional(): Schema<Src | null> {
    return new StringSchema<Src | null>(this.options, true);
  }

  serialize(): SerializedSchema {
    throw new Error("Method not implemented.");
  }
}

export const string = <T extends string>(
  options?: StringOptions
): Schema<T> => {
  return new StringSchema(options);
};

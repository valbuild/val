/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";

type StringOptions = {
  maxLength?: number;
  minLength?: number;
};

export type SerializedStringSchema = {
  type: "string";
  options?: StringOptions;
  opt: boolean;
};

export class StringSchema<Src extends string> extends Schema<Src> {
  protected validate(src: string): false | string[] {
    throw new Error("Method not implemented.");
  }
  protected serialize(): SerializedSchema {
    throw new Error("Method not implemented.");
  }
}

export const string = <T extends string>(
  options?: StringOptions
): Schema<T> => {
  return new StringSchema();
};

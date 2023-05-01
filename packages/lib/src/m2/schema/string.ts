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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected validate(src: string): false | string[] {
    throw new Error("Method not implemented.");
  }
  protected serialize(): SerializedSchema {
    throw new Error("Method not implemented.");
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const string = (options?: StringOptions): Schema<string> => {
  throw new Error("Method not implemented.");
};

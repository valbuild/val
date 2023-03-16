import { NumberDescriptor } from "../descriptor";
import { Schema } from "./Schema";

export type SerializedNumberSchema = {
  type: "number";
};

export class NumberSchema extends Schema<number> {
  validate(): false | string[] {
    return false;
  }

  apply(input: string): string {
    return input;
  }

  descriptor(): NumberDescriptor {
    return NumberDescriptor;
  }

  serialize(): SerializedNumberSchema {
    return {
      type: "number",
    };
  }

  static deserialize(): NumberSchema {
    return new NumberSchema();
  }
}
export const number = (): NumberSchema => {
  return new NumberSchema();
};

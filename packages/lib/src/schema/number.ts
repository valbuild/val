import { NumberDescriptor } from "../descriptor";
import { Schema } from "./Schema";

export type SerializedNumberSchema = {
  type: "number";
};

export class NumberSchema extends Schema<number, number> {
  validate(): false | string[] {
    return false;
  }

  hasI18n(): false {
    return false;
  }

  localize(src: number): number {
    return src;
  }

  localizePath(_src: number, path: string[]): string[] {
    return path;
  }

  localDescriptor(): NumberDescriptor {
    return NumberDescriptor;
  }

  rawDescriptor(): NumberDescriptor {
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

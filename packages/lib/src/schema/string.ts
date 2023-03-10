import * as lens from "../lens";
import { StringDescriptor } from "../lens/descriptor";
import { newPrimitiveSelector } from "../selector/primitive";
import { Selector } from "../selector/selector";
import { Schema } from "./Schema";

type StringOptions = {
  maxLength?: number;
  minLength?: number;
};

export type SerializedStringSchema = {
  type: "string";
  options?: {
    maxLength?: number;
    minLength?: number;
  };
};

export class StringSchema extends Schema<string, string> {
  constructor(private readonly options?: StringOptions) {
    super();
  }

  validate(input: string): false | string[] {
    const errors: string[] = [];
    if (
      this.options?.maxLength !== undefined &&
      input.length > this.options.maxLength
    ) {
      errors.push(
        `String '${input}' is too long. Length: ${input.length}. Max ${this.options.maxLength}`
      );
    }
    if (
      this.options?.minLength !== undefined &&
      input.length < this.options.minLength
    ) {
      errors.push(
        `String '${input}' is too short. Length: ${input.length}.Min ${this.options.minLength}.`
      );
    }
    if (errors.length > 0) {
      return errors;
    }

    return false;
  }

  apply(input: string): string {
    return input;
  }

  descriptor(): StringDescriptor {
    return StringDescriptor;
  }

  select(): Selector<string, string> {
    return newPrimitiveSelector(lens.identity());
  }

  serialize(): SerializedStringSchema {
    return {
      type: "string",
      options: this.options,
    };
  }

  static deserialize(schema: SerializedStringSchema): StringSchema {
    return new StringSchema(schema.options);
  }
}
export const string = (options?: StringOptions): Schema<string, string> => {
  return new StringSchema(options);
};

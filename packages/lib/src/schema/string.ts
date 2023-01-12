import { Schema } from "./Schema";

type StringOptions = {
  maxLength?: number;
  minLength?: number;
};

export type SerializedStringSchema = {
  type: "string";
  options: {
    maxLength?: number;
    minLength?: number;
  };
};

class StringSchema extends Schema<string> {
  constructor(private readonly options?: StringOptions) {
    super();
  }

  validate(input: string): false | string[] {
    const errors: string[] = [];
    if (this.options?.maxLength && input.length > this.options.maxLength) {
      errors.push(
        `String '${input}' is too long. Length: ${input.length}. Max ${this.options.maxLength}`
      );
    }
    if (this.options?.minLength && input.length < this.options.minLength) {
      errors.push(
        `String '${input}' is too short. Length: ${input.length}.Min ${this.options.minLength}.`
      );
    }
    if (errors.length > 0) {
      return errors;
    }

    return false;
  }

  serialize(): SerializedStringSchema {
    return {
      type: "string",
      options: {
        maxLength: this.options?.maxLength,
        minLength: this.options?.minLength,
      },
    };
  }
}
export const string = (options?: StringOptions): Schema<string> => {
  return new StringSchema(options);
};

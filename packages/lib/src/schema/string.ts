import { Schema } from "./Schema";

type StringOptions = {
  maxLength?: number;
  minLength?: number;
};

class StringSchema extends Schema<string> {
  constructor(private readonly options?: StringOptions) {
    super();
  }

  validate(input: string): false | string[] {
    const errors: string[] = [];
    if (this.options?.maxLength && input.length > this.options.maxLength) {
      errors.push(
        `String '${input}' is too long (max ${this.options.maxLength})`
      );
    }
    if (this.options?.minLength && input.length < this.options.minLength) {
      errors.push(
        `String '${input}' is too short (min ${this.options.minLength})`
      );
    }
    if (errors.length > 0) {
      return errors;
    }

    return false;
  }
}
export const string = (options?: StringOptions): Schema<string> => {
  return new StringSchema(options);
};

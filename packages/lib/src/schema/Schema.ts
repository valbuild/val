type ValidTypes = string;

export abstract class Schema<T extends ValidTypes> {
  /**
   * Validate a value against this schema
   *
   * @param input
   * @internal
   */
  abstract validate(input: T): false | string[];
}

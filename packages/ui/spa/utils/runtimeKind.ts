/**
 * The runtime kind of a value, for error messages.
 *
 * `typeof` reports both `null` and an array as `"object"`, which is exactly the
 * distinction that matters when a field says it got an object but the value is
 * an array or a null.
 */
export function runtimeKind(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

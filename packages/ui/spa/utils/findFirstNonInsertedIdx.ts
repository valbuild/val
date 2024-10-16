/**
 * Finds the index of the first element in the `current` array that is not present in the `prev` array.
 * If the `prev` array is undefined, it returns 0.
 * If any element in the `current` array does not match the corresponding element in the `prev` array, it returns 0.
 * If all elements in the `current` array match the corresponding elements in the `prev` array, it returns the length of the `current` array.
 *
 * @param current - The current array of strings.
 * @param prev - The previous array of strings (optional).
 * @returns The index of the first non-inserted element, or 0 if a full reset is required.
 */
export function findFirstNonInsertedIdx(current: string[], prev?: string[]) {
  if (prev === undefined) {
    return 0;
  }
  if (current.length < prev.length) {
    return 0;
  }
  for (let i = 0; i < current.length; i++) {
    const requireFullReset = prev[i] !== undefined && current[i] !== prev[i];
    if (requireFullReset) {
      return 0;
    } else if (prev[i] === undefined) {
      return i;
    }
  }
  return current.length;
}

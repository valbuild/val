/**
 * The value at `path` in a module's source, for `get_source`'s `path`: the
 * same path arrays `create_patch` takes, so a part of a module too big to
 * read whole can be read, and patched, by the one path. No path is the
 * whole source.
 */
export type ValueAtPath =
  | { status: "found"; value: unknown }
  | { status: "invalid"; message: string };

export function valueAtPath(source: unknown, path: unknown): ValueAtPath {
  if (path === undefined || path === null) {
    return { status: "found", value: source };
  }
  if (!Array.isArray(path) || !path.every((p) => typeof p === "string")) {
    return {
      status: "invalid",
      message:
        "path must be a list of keys and indexes as strings, as create_patch's path is, e.g. ['posts', '3', 'title'].",
    };
  }
  let value: unknown = source;
  for (let depth = 0; depth < path.length; depth++) {
    const segment: string = path[depth];
    const found = childOf(value, segment);
    if (found === undefined) {
      const there = path.slice(0, depth);
      return {
        status: "invalid",
        message:
          `There is nothing at ${JSON.stringify(path.slice(0, depth + 1))} in this module: ` +
          (there.length === 0
            ? "read it without a path to see its keys."
            : `read path ${JSON.stringify(there)} to see what is there.`),
      };
    }
    value = found.value;
  }
  return { status: "found", value };
}

function childOf(
  value: unknown,
  segment: string,
): { value: unknown } | undefined {
  if (Array.isArray(value)) {
    // Only a canonical index: "", "1.0" and " 1" are numbers to `Number`,
    // and would read an item nobody named.
    if (!/^(0|[1-9][0-9]*)$/.test(segment)) return undefined;
    const index = Number(segment);
    if (index >= value.length) return undefined;
    return { value: value[index] };
  }
  if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, segment)) {
    return { value: value[segment] };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

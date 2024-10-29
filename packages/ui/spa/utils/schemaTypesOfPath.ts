import { SerializedSchema } from "@valbuild/core";

/**
 * This functions returns all the possible schema types of a given module path.
 */
export function schemaTypesOfPath(
  schema: SerializedSchema,
  patchPath?: string[],
): Set<SerializedSchema["type"]> {
  if (!patchPath || patchPath.length === 0) {
    return new Set([schema.type]);
  }
  const branches: Set<SerializedSchema["type"]> = new Set();
  let current = schema;
  let i = -1;
  for (const pathPart of patchPath) {
    i++;
    if (!current) {
      break;
    }
    if (current.type === "array") {
      current = current.item;
    } else if (current.type === "record") {
      current = current.item;
    } else if (current.type === "object") {
      current = current.items[pathPart];
    } else if (current.type === "union") {
      if (typeof current.key === "string") {
        const types = current.items;
        for (const type of types) {
          const subTypes = schemaTypesOfPath(type, patchPath.slice(i));
          for (const subType of Array.from(subTypes.values())) {
            branches.add(subType);
          }
        }
        return branches;
      } else {
        if (i !== patchPath.length - 1) {
          throw new Error(
            "Found string union (primitive), but path has more parts: " +
              patchPath.join("/") +
              " at " +
              pathPart,
          );
        }
        break;
      }
    } else if (
      current.type === "boolean" ||
      current.type === "number" ||
      current.type === "string" ||
      current.type === "date" ||
      current.type === "file" ||
      current.type === "image" ||
      current.type === "keyOf" ||
      current.type === "literal" ||
      current.type === "richtext"
    ) {
      if (i !== patchPath.length - 1) {
        throw new Error(
          "Found " +
            current.type +
            " (primitive), but path has more parts: " +
            patchPath.join("/") +
            " at " +
            pathPart,
        );
      }
      break;
    } else {
      const _unreachable: never = current;
      const unknownType = (_unreachable as { type: string }).type;
      console.error(
        `Unexecpted resolved schema type: ${unknownType} in ${patchPath.join("/")} at ${pathPart}`,
      );
      return new Set([unknownType as SerializedSchema["type"]]);
    }
  }
  if (current) {
    branches.add(current.type);
  }
  return branches;
}

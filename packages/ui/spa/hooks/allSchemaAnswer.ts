import { cappedToolResult } from "./capToolResult";

/**
 * `get_all_schema`'s answer: every module's schema, or the ones asked for
 * by `module_file_paths`, capped. A module's schema is whole or not there:
 * half of one reads as a module without the fields that were cut. A path
 * asked for that is not a module is said, rather than answered with `{}`,
 * which reads as "these modules have no fields".
 */
export function allSchemaAnswer(
  schemas: Record<string, unknown>,
  asked: unknown,
  maxChars?: number,
): unknown {
  const only =
    Array.isArray(asked) && asked.length > 0
      ? asked.filter((p): p is string => typeof p === "string")
      : null;
  const chosen =
    only === null
      ? schemas
      : Object.fromEntries(
          Object.entries(schemas).filter(([path]) => only.includes(path)),
        );
  const capped = cappedToolResult(chosen, {
    wholeDepth: 1,
    narrow:
      "Ask for the modules left out with module_file_paths, a few at a time.",
    ...(maxChars !== undefined ? { maxChars } : {}),
  });
  const notFound =
    only === null
      ? []
      : only.filter(
          (path) => !Object.prototype.hasOwnProperty.call(schemas, path),
        );
  if (notFound.length === 0) return capped;
  return {
    schemas: capped,
    notFound,
    note:
      `${notFound.length === 1 ? "This is not a module" : "These are not modules"} of this project: ${notFound.join(", ")}. ` +
      "Module paths are exact, e.g. '/content/homepage.val.ts': call get_all_schema without module_file_paths to list them.",
  };
}

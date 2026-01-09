import { Internal, ModuleFilePath, SerializedSchema } from "@valbuild/core";

/**
 * Get all modules that depend on the input param moduleFilePath
 *
 * TODO: remove this if it is no longer in use. We were unsure when we wrote this whether we it makes sense at all, or if we should have some other way of detecting which modules that needs to be refreshed
 **/
export function getDependentModuleFiles(
  moduleFilePath: ModuleFilePath,
  schema: Record<ModuleFilePath, SerializedSchema>,
) {
  const schemaAtModule = schema[moduleFilePath];
  const dependentModulePaths: Set<ModuleFilePath> = new Set();
  if (!schemaAtModule) {
    return [];
  }
  function rec(
    rootModuleFilePath: ModuleFilePath,
    schemaNode: SerializedSchema,
  ) {
    if (schemaNode.type === "array" || schemaNode.type === "record") {
      rec(rootModuleFilePath, schemaNode.item);
    } else if (schemaNode.type === "object") {
      for (const key in schemaNode.items) {
        rec(rootModuleFilePath, schemaNode.items[key]);
      }
    } else if (schemaNode.type === "keyOf") {
      const [dependency] = Internal.splitModuleFilePathAndModulePath(
        schemaNode.path,
      );
      if (dependency === moduleFilePath) {
        dependentModulePaths.add(rootModuleFilePath);
      }
    } else if (schemaNode.type === "union") {
      // TODO: we could figure out if it is not only potentially dependent but ACTUALLY dependent, but then we would need the source - we figured it is not worth it?
      for (const item of schemaNode.items) {
        if (item.type === "object") {
          for (const key in item.items) {
            rec(rootModuleFilePath, item.items[key]);
          }
        }
      }
    } else if (
      schemaNode.type === "richtext" ||
      schemaNode.type === "boolean" ||
      schemaNode.type === "string" ||
      schemaNode.type === "literal" ||
      schemaNode.type === "date" ||
      schemaNode.type === "file" ||
      schemaNode.type === "image" ||
      schemaNode.type === "number" ||
      schemaNode.type === "route"
    ) {
      // ignore
    } else {
      const exhaustiveCheck: never = schemaNode;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = `Val: getDependentModuleFiles: unexpected schema type: ${(exhaustiveCheck as any)?.type}`;
      console.error(msg);
      throw new Error(msg);
    }
  }
  for (const schemaModuleFilePathS in schema) {
    const schemaModuleFilePath = schemaModuleFilePathS as ModuleFilePath;
    const schemaNode = schema[schemaModuleFilePath];
    if (schemaModuleFilePath !== moduleFilePath) {
      rec(schemaModuleFilePath, schemaNode);
    }
  }

  return Array.from(dependentModulePaths).sort();
}

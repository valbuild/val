import {
  Internal,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";

export type InclusionReason =
  | { type: "patched" }
  | { type: "keyOf"; from: ModuleFilePath }
  | { type: "referencedModule"; from: ModuleFilePath }
  | { type: "router" };

/**
 * The set of modules a snapshot has to carry so that it both evaluates and
 * validates the same way the customer's project does.
 *
 * Starts from the modules the pending patches touch and closes over the
 * cross-module references a schema can hold:
 *  - `keyOf` points at another module through its `path` (a SourcePath)
 *  - `image`/`file` point at a gallery module through `referencedModule`
 *  - route validation cross-references *every* router module, so if any
 *    included module has a route or router we need all of them
 */
export function resolveModuleClosure(
  patchedModules: ModuleFilePath[],
  serializedSchemas: Record<ModuleFilePath, SerializedSchema>,
): Map<ModuleFilePath, InclusionReason[]> {
  const included = new Map<ModuleFilePath, InclusionReason[]>();
  const addReason = (
    moduleFilePath: ModuleFilePath,
    reason: InclusionReason,
  ): boolean => {
    const existing = included.get(moduleFilePath);
    if (existing) {
      existing.push(reason);
      return false;
    }
    included.set(moduleFilePath, [reason]);
    return true;
  };

  const queue: ModuleFilePath[] = [];
  for (const moduleFilePath of patchedModules) {
    if (addReason(moduleFilePath, { type: "patched" })) {
      queue.push(moduleFilePath);
    }
  }

  let needsAllRouterModules = false;
  while (queue.length > 0) {
    const moduleFilePath = queue.shift();
    if (moduleFilePath === undefined) {
      continue;
    }
    const schema = serializedSchemas[moduleFilePath];
    if (!schema) {
      continue;
    }
    const refs = collectSchemaReferences(schema);
    if (refs.hasRouteOrRouter) {
      needsAllRouterModules = true;
    }
    for (const keyOfPath of refs.keyOfSourcePaths) {
      const [referenced] = Internal.splitModuleFilePathAndModulePath(keyOfPath);
      if (addReason(referenced, { type: "keyOf", from: moduleFilePath })) {
        queue.push(referenced);
      }
    }
    for (const referencedModule of refs.referencedModules) {
      // referencedModule is a module file path written in the schema, so it is
      // only trustworthy insofar as it names a module we know about.
      const referenced = Object.keys(serializedSchemas).find(
        (candidate) => candidate === referencedModule,
      );
      if (referenced === undefined) {
        continue;
      }
      if (
        addReason(referenced as ModuleFilePath, {
          type: "referencedModule",
          from: moduleFilePath,
        })
      ) {
        queue.push(referenced as ModuleFilePath);
      }
    }
  }

  if (needsAllRouterModules) {
    for (const [moduleFilePathS, schema] of Object.entries(serializedSchemas)) {
      if (collectSchemaReferences(schema).isRouterModule) {
        addReason(moduleFilePathS as ModuleFilePath, { type: "router" });
      }
    }
  }

  return included;
}

type SchemaReferences = {
  keyOfSourcePaths: SourcePath[];
  referencedModules: string[];
  /** This module has a route field or is a router module. */
  hasRouteOrRouter: boolean;
  isRouterModule: boolean;
};

function collectSchemaReferences(schema: SerializedSchema): SchemaReferences {
  const refs: SchemaReferences = {
    keyOfSourcePaths: [],
    referencedModules: [],
    hasRouteOrRouter: false,
    isRouterModule: false,
  };
  const visit = (node: SerializedSchema, isRoot: boolean) => {
    switch (node.type) {
      case "keyOf":
        refs.keyOfSourcePaths.push(node.path);
        break;
      case "route":
        refs.hasRouteOrRouter = true;
        break;
      case "file":
      case "image":
        if (node.referencedModule) {
          refs.referencedModules.push(node.referencedModule);
        }
        break;
      case "record":
        if (node.router) {
          refs.hasRouteOrRouter = true;
          if (isRoot) {
            refs.isRouterModule = true;
          }
        }
        visit(node.item, false);
        if (node.key) {
          visit(node.key, false);
        }
        if (node.alt) {
          visit(node.alt, false);
        }
        break;
      case "array":
        visit(node.item, false);
        break;
      case "object":
        for (const item of Object.values(node.items)) {
          visit(item, false);
        }
        break;
      case "union":
        if (typeof node.key !== "string") {
          visit(node.key, false);
        }
        for (const item of node.items) {
          visit(item, false);
        }
        break;
      default:
        break;
    }
  };
  visit(schema, true);
  return refs;
}

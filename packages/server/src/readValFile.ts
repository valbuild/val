import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { QuickJSRuntime } from "quickjs-emscripten";
import { SerializedModuleContent } from "./SerializedModuleContent";
import { getSyntheticContainingPath } from "./getSyntheticContainingPath";

export const readValFile = async (
  moduleFilePath: ModuleFilePath,
  rootDirPath: string,
  runtime: QuickJSRuntime,
  options: { validate: boolean; source: boolean; schema: boolean }
): Promise<SerializedModuleContent> => {
  const context = runtime.newContext();

  // avoid failures when console.log is called
  const logHandle = context.newFunction("log", () => {
    // do nothing
  });
  const consoleHandle = context.newObject();
  context.setProp(consoleHandle, "log", logHandle);
  context.setProp(context.global, "console", consoleHandle);

  consoleHandle.dispose();
  logHandle.dispose();

  // avoid failures when process.env is called
  const envHandle = context.newObject();
  const processHandle = context.newObject();
  context.setProp(processHandle, "env", envHandle);
  context.setProp(context.global, "process", processHandle);

  const optionsHandle = context.newObject();
  if (options) {
    if (options.validate !== undefined) {
      context.setProp(
        optionsHandle,
        "validate",
        context.newNumber(+options.validate)
      );
    }
    if (options.source !== undefined) {
      context.setProp(
        optionsHandle,
        "source",
        context.newNumber(+options.source)
      );
    }
    if (options.schema !== undefined) {
      context.setProp(
        optionsHandle,
        "schema",
        context.newNumber(+options.schema)
      );
    }
  }
  context.setProp(context.global, "__VAL_OPTIONS__", optionsHandle);

  envHandle.dispose();
  processHandle.dispose();
  optionsHandle.dispose();

  try {
    const modulePath = `.${moduleFilePath
      .replace(".val.js", ".val")
      .replace(".val.ts", ".val")
      .replace(".val.tsx", ".val")
      .replace(".val.jsx", ".val")}`;
    const code = `import * as valModule from ${JSON.stringify(modulePath)};
import { Internal } from "@valbuild/core";

globalThis.valModule = { 
  path: valModule?.default && Internal.getValPath(valModule?.default),
  schema: !!globalThis['__VAL_OPTIONS__'].schema ? valModule?.default && Internal.getSchema(valModule?.default)?.serialize() : undefined,
  source: !!globalThis['__VAL_OPTIONS__'].source ? valModule?.default && Internal.getSource(valModule?.default) : undefined,
  validation: !!globalThis['__VAL_OPTIONS__'].validate ? valModule?.default && Internal.getSchema(valModule?.default)?.validate(
    valModule?.default && Internal.getValPath(valModule?.default) || "/",
    valModule?.default && Internal.getSource(valModule?.default)
  ) : undefined,
  defaultExport: !!valModule?.default,
};
`;
    const result = context.evalCode(
      code,
      getSyntheticContainingPath(rootDirPath)
    );
    const fatalErrors: string[] = [];
    if (result.error) {
      const error = result.error.consume(context.dump);
      console.error(
        `Fatal error reading val file: ${moduleFilePath}. Error: ${error.message}\n`,
        error.stack
      );
      return {
        path: moduleFilePath as string as SourcePath,
        errors: {
          invalidModulePath: moduleFilePath as ModuleFilePath,
          fatal: [
            {
              message: `${error.name || "Unknown error"}: ${
                error.message || "<no message>"
              }`,
              stack: error.stack,
            },
          ],
        },
      };
    } else {
      result.value.dispose();
      const valModule = context
        .getProp(context.global, "valModule")
        .consume(context.dump);
      if (
        // if one of these are set it is a Val module, so must validate
        valModule?.path !== undefined ||
        valModule?.schema !== undefined ||
        valModule?.source !== undefined
      ) {
        if (valModule.path !== moduleFilePath) {
          fatalErrors.push(
            `Wrong c.define id! Expected: '${moduleFilePath}', found: '${valModule.path}'`
          );
        } else if (
          encodeURIComponent(valModule.id).replace(/%2F/g, "/") !== valModule.id
        ) {
          fatalErrors.push(
            `Invalid c.define id! Must be a web-safe path without escape characters, found: '${
              valModule.id
            }', which was encoded as: '${encodeURIComponent(
              valModule.id
            ).replace("%2F", "/")}'`
          );
        } else if (valModule?.schema === undefined && options.schema) {
          fatalErrors.push(
            `Expected val id: '${moduleFilePath}' to have a schema`
          );
        } else if (valModule?.source === undefined && options.source) {
          fatalErrors.push(
            `Expected val id: '${moduleFilePath}' to have a source`
          );
        }
      }
      let errors: SerializedModuleContent["errors"] = false;
      if (fatalErrors.length > 0) {
        errors = {
          invalidModulePath:
            valModule.path !== moduleFilePath
              ? (moduleFilePath as ModuleFilePath)
              : undefined,
          fatal: fatalErrors.map((message) => ({ message })),
        };
      }
      if (valModule?.validation) {
        errors = {
          ...(errors ? errors : {}),
          validation: valModule.validation,
        };
      }
      return {
        path: valModule.id || moduleFilePath, // NOTE: we use path here, since SerializedModuleContent (maybe bad name?) can be used for whole modules as well as subparts of modules
        source: valModule.source,
        schema: valModule.schema,
        errors,
      };
    }
  } finally {
    context.dispose();
  }
};

import { ModuleId, SourcePath } from "@valbuild/core";
import path from "path";
import { QuickJSRuntime } from "quickjs-emscripten";
import { SerializedModuleContent } from "./SerializedModuleContent";

export const readValFile = async (
  id: string,
  valConfigPath: string,
  runtime: QuickJSRuntime
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

  envHandle.dispose();
  processHandle.dispose();

  try {
    const modulePath = `.${id}.val`;
    const code = `import * as valModule from ${JSON.stringify(modulePath)};
import { Internal } from "@valbuild/core";

globalThis.valModule = { 
  id: valModule?.default && Internal.getValPath(valModule?.default),
  schema: valModule?.default && Internal.getSchema(valModule?.default)?.serialize(),
  source: valModule?.default && Internal.getSource(valModule?.default),
  validation: valModule?.default && Internal.getSchema(valModule?.default)?.validate(
    valModule?.default && Internal.getValPath(valModule?.default) || "/",
    valModule?.default && Internal.getSource(valModule?.default)
  ),
  defaultExport: !!valModule?.default,
};
`;
    const result = context.evalCode(
      code,
      // Synthetic module name
      path.join(path.dirname(valConfigPath), "<val>")
    );
    const fatalErrors: string[] = [];
    if (result.error) {
      const error = result.error.consume(context.dump);
      console.error(
        `Fatal error reading val file: ${id}. Error: ${error.message}\n`,
        error.stack
      );
      return {
        path: id as SourcePath,
        errors: {
          invalidModuleId: id as ModuleId,
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
        valModule?.id !== undefined ||
        valModule?.schema !== undefined ||
        valModule?.source !== undefined
      ) {
        if (valModule.id !== id) {
          fatalErrors.push(
            `Wrong c.define id! Expected: '${id}', found: '${valModule.id}'`
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
        } else if (valModule?.schema === undefined) {
          fatalErrors.push(`Expected val id: '${id}' to have a schema`);
        } else if (valModule?.source === undefined) {
          fatalErrors.push(`Expected val id: '${id}' to have a source`);
        }
      }
      let errors: SerializedModuleContent["errors"] = false;
      if (fatalErrors.length > 0) {
        errors = {
          invalidModuleId: valModule.id !== id ? (id as ModuleId) : undefined,
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
        path: valModule.id || id, // NOTE: we use path here, since SerializedModuleContent (maybe bad name?) can be used for whole modules as well as subparts of modules
        source: valModule.source,
        schema: valModule.schema,
        errors,
      };
    }
  } finally {
    context.dispose();
  }
};

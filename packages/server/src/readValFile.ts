import { ModuleId } from "@valbuild/core";
import path from "path";
import { QuickJSRuntime } from "quickjs-emscripten";
import { SerializedModuleContent } from "./SerializedModuleContent";

export const readValFile = async (
  id: string,
  valConfigPath: string,
  runtime: QuickJSRuntime
): Promise<SerializedModuleContent> => {
  const context = runtime.newContext();
  try {
    const modulePath = `.${id}.val`;
    const code = `import * as valModule from ${JSON.stringify(modulePath)};
import { Internal } from "@valbuild/core";
globalThis.valModule = { 
  id: valModule?.default && Internal.getValPath(valModule?.default),
  schema: valModule?.default && Internal.getSchema(valModule?.default)?.serialize(),
  source: valModule?.default && Internal.getRawSource(valModule?.default),
  validation: valModule?.default && Internal.getSchema(valModule?.default)?.validate(
    valModule?.default && Internal.getValPath(valModule?.default) || "/",
    valModule?.default && Internal.getRawSource(valModule?.default)
  )
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
      return {
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

      if (!valModule) {
        fatalErrors.push(`Could not find any modules at: ${id}`);
      } else {
        if (valModule.id !== id) {
          fatalErrors.push(
            `Expected val id: '${id}' but got: '${valModule.id}'`
          );
        }
        if (!valModule?.schema) {
          fatalErrors.push(`Expected val id: '${id}' to have a schema`);
        }
        if (!valModule?.source) {
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
        path: valModule.id, // NOTE: we use path here, since SerializedModuleContent (maybe bad name?) can be used for whole modules as well as subparts of modules
        source: valModule.source,
        schema: valModule.schema,
        errors,
      };
    }
  } finally {
    context.dispose();
  }
};

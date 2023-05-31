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
import { Internal } from "@valbuild/lib";
globalThis.valModule = { 
  id: valModule?.default && Internal.getValPath(valModule?.default),
  schema: valModule?.default && Internal.getSchema(valModule?.default)?.serialize(),
  source: valModule?.default && Internal.getRawSource(valModule?.default),
};
`;
    const result = context.evalCode(
      code,
      // Synthetic module name
      path.join(path.dirname(valConfigPath), "<val>")
    );
    if (result.error) {
      const error = result.error.consume(context.dump);
      console.error("Got error", error); // TODO: use this to figure out how to strip out QuickJS specific errors and get the actual stack

      throw new Error(
        `Could not read val id: ${id}. Cause:\n${error.name}: ${error.message}${
          error.stack ? error.stack : ""
        }`
      );
    } else {
      result.value.dispose();
      const valModule = context
        .getProp(context.global, "valModule")
        .consume(context.dump);

      const errors: string[] = [];

      if (!valModule) {
        errors.push(`Could not find any modules at: ${id}`);
      } else {
        if (valModule.id !== id) {
          errors.push(`Expected val id: '${id}' but got: '${valModule.id}'`);
        }
        if (!valModule?.schema) {
          errors.push(`Expected val id: '${id}' to have a schema`);
        }
        if (!valModule?.source) {
          errors.push(`Expected val id: '${id}' to have a source`);
        }
      }

      if (errors.length > 0) {
        throw Error(
          `While processing module of id: ${id}, we got the following errors:\n${errors.join(
            "\n"
          )}`
        );
      }
      return {
        path: valModule.id, // This might not be the asked id/path, however, that should be handled further up in the call chain
        source: valModule.source,
        schema: valModule.schema,
      };
    }
  } finally {
    context.dispose();
  }
};

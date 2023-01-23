import path from "path";
import { SerializedSchema, ValidTypes } from "@valbuild/lib";
import { QuickJSRuntime } from "quickjs-emscripten";

export const readValFile = async (
  id: string,
  valConfigPath: string,
  runtime: QuickJSRuntime
): Promise<{ val: ValidTypes; schema: SerializedSchema }> => {
  const context = runtime.newContext();
  try {
    const modulePath = `.${id}.val`;
    const code = `import * as valModule from ${JSON.stringify(modulePath)};
globalThis.valModule = { id: valModule?.default?.id, ...valModule?.default?.val?.serialize() };
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
        if (!valModule?.id) {
          errors.push(`Could not verify id of val module: '${id}'`);
        } else if (valModule.id !== id) {
          errors.push(`Expected val id: '${id}' but got: '${valModule.id}'`);
        }
        if (!valModule?.schema) {
          errors.push(`Expected val id: '${id}' to have a schema`);
        }
        if (!valModule?.val) {
          errors.push(`Expected val id: '${id}' to have a val`);
        }
      }

      if (errors.length > 0) {
        throw Error(
          `While processing a val file, we got the following errors:\n${errors.join(
            "\n"
          )}`
        );
      }
      return {
        val: valModule.val,
        schema: valModule.schema,
      };
    }
  } finally {
    context.dispose();
  }
};

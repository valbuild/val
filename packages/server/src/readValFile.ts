import path from "path";
import { SerializedSchema, ValidTypes } from "@valbuild/lib";
import { newQuickJSAsyncWASMModule } from "quickjs-emscripten";
import { ValFileSystemModuleResolver } from "./ValModuleResolver";

export const readValFile = async (
  rootDir: string,
  id: string
): Promise<{ val: ValidTypes; schema: SerializedSchema }> => {
  const moduleResolver = new ValFileSystemModuleResolver(rootDir);
  const module = await newQuickJSAsyncWASMModule();
  const runtime = module.newRuntime();
  // TODO: these were randomly chosen, we should figure out what the right values are:
  runtime.setMaxStackSize(1024 * 640);
  runtime.setMemoryLimit(1024 * 640);

  runtime.setModuleLoader(
    async (modulePath) => {
      return moduleResolver.getTranspiledCode(modulePath);
    },
    (baseModuleName, requestedName) => {
      return moduleResolver.resolveModulePath(baseModuleName, requestedName);
    }
  );

  const context = runtime.newContext();
  const modulePath = `./${id}.val`;
  const result = await context.evalCodeAsync(
    `
    import * as valModule from ${JSON.stringify(modulePath)};
    globalThis.valModule = { id: valModule?.default?.id, ...valModule?.default?.val?.serialize() };
    `,
    path.resolve(rootDir, "./val-system.js")
  );
  if (result.error) {
    const error = result.error.consume(context.dump);
    console.error("Got error", error); // TODO: use this to figure out how to strip out QuickJS specific errors and get the actual stack

    throw new Error(
      `Could not read val id: ${id} in root dir ${rootDir}. Cause:\n${error.name}: ${error.message}${error.stack}`
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
        errors.push(`Could not verify id of val module: ${id}`);
      } else if (valModule.id !== id) {
        errors.push(`Expected val id: ${id} but got: ${valModule.id}`);
      }
      if (!valModule?.schema) {
        errors.push(`Expected val id: ${id} to have a schema`);
      }
      if (!valModule?.val) {
        errors.push(`Expected val id: ${id} to have a val`);
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
};

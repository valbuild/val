import path from "path";
import fs from "fs/promises";
import vm from "node:vm";
import ts from "typescript"; // TODO: make this dependency optional (only required if the file is val.config.ts not val.config.js)
import z from "zod";
import { ValConfig } from "@valbuild/core";

const ValConfigSchema = z.object({
  project: z.string().optional(),
  root: z.string().optional(),
  files: z
    .object({
      directory: z
        .string()
        .refine((val): val is `/public/val` => val.startsWith("/public/val"), {
          message: "files.directory must start with '/public/val'",
        }),
    })
    .optional(),
  gitCommit: z.string().optional(),
  gitBranch: z.string().optional(),
  defaultTheme: z.union([z.literal("light"), z.literal("dark")]).optional(),
  ai: z
    .object({
      commitMessages: z
        .object({
          disabled: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
});

export async function evalValConfigFile(
  projectRoot: string,
  configFileName: string,
): Promise<ValConfig | null> {
  const valConfigPath = path.join(projectRoot, configFileName);

  let code: string | null = null;
  try {
    code = await fs.readFile(valConfigPath, "utf-8");
  } catch (err) {
    //
  }
  if (!code) {
    return null;
  }

  const transpiled = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: valConfigPath,
  });

  const exportsObj = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sandbox: Record<string, any> = {
    exports: exportsObj,
    module: { exports: exportsObj },
    require, // NOTE: this is a security risk, but this code is running in the users own environment at the CLI level
    __filename: valConfigPath,
    __dirname: path.dirname(valConfigPath),
    console,
    process,
  };
  sandbox.global = sandbox;

  const context = vm.createContext(sandbox);
  const script = new vm.Script(transpiled.outputText, {
    filename: valConfigPath,
  });
  script.runInContext(context);
  const valConfig = sandbox.module.exports.config;
  if (!valConfig) {
    throw Error(
      `Val config file at path: '${valConfigPath}' must export a config object. Got: ${valConfig}`,
    );
  }
  const result = ValConfigSchema.safeParse(valConfig);
  if (!result.success) {
    throw Error(
      `Val config file at path: '${valConfigPath}' has invalid schema: ${result.error.message}`,
    );
  }
  return result.data;
}

import path from "path";
import fs from "fs/promises";
import vm from "node:vm";
import ts from "typescript"; // TODO: make this dependency optional (only required if the file is val.config.ts not val.config.js)
import z from "zod";
import { ValConfig } from "@valbuild/core";
import { createRequire } from "node:module";

/**
 * NOTE: this is intentionally NOT `SharedValConfig` from `@valbuild/shared`.
 * That schema requires `files.directory` to be exactly `/public/val`, whereas
 * this one accepts any path beneath `/public`. Unifying them would change which
 * configs are accepted, so they are kept separate on purpose.
 */
const ValConfigSchema = z.object({
  project: z.string().optional(),
  root: z.string().optional(),
  files: z
    .object({
      directory: z.string().refine(
        (val): val is `/public` | `/public/${string}` =>
          (val === "/public" ||
            (val.startsWith("/public/") && !val.endsWith("/"))) &&
          // Reject path traversal so the directory cannot escape /public
          !val
            .split("/")
            .some((segment) => segment === "." || segment === ".."),
        {
          message:
            "files.directory must start with '/public', must not end with '/' and must not contain '.' or '..' segments",
        },
      ),
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

/**
 * `ENOENT` (nothing at this path) and `ENOTDIR` (a path segment is a file) both
 * mean the config file simply is not there.
 */
function isFileNotFound(err: unknown): boolean {
  const code =
    err && typeof err === "object" && "code" in err
      ? (err as { code?: unknown }).code
      : undefined;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Read and evaluate a `val.config.{ts,js}` file from disk.
 *
 * Returns `null` if the file does not exist, and throws if it exists but does
 * not export a valid `config` object.
 *
 * Used by the Val CLI and by `@valbuild/language-server`, so that an editor
 * resolves project config exactly the way the CLI does.
 */
export async function evalValConfigFile(
  projectRoot: string,
  configFileName: string,
): Promise<ValConfig | null> {
  const valConfigPath = path.join(projectRoot, configFileName);

  let code: string;
  try {
    code = await fs.readFile(valConfigPath, "utf-8");
  } catch (err) {
    // A missing file means "this project does not use this config file name",
    // which callers handle by trying the next candidate. Anything else (no read
    // permission, an IO error, a directory where a file was expected) is a real
    // problem and must not be reported as "no config".
    if (isFileNotFound(err)) {
      return null;
    }
    throw Error(
      `Could not read Val config file at path: '${valConfigPath}': ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!code.trim()) {
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

  const projectRootRequire = createRequire(valConfigPath);
  const exportsObj = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sandbox: Record<string, any> = {
    exports: exportsObj,
    module: { exports: exportsObj },
    require: projectRootRequire, // NOTE: this is a security risk, but this code is running in the users own environment at the CLI level
    __filename: valConfigPath,
    __dirname: projectRoot,
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

/**
 * Resolve the project's Val config, trying the TypeScript file first and
 * falling back to JavaScript. Mirrors what the CLI has always done at each of
 * its call sites.
 */
export async function findAndEvalValConfigFile(
  projectRoot: string,
): Promise<ValConfig | null> {
  return (
    (await evalValConfigFile(projectRoot, "val.config.ts")) ||
    (await evalValConfigFile(projectRoot, "val.config.js"))
  );
}

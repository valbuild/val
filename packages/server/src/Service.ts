import { patchValFile } from "./patchValFile";
import { Patch } from "@valbuild/core/patch";
import { ValSourceFileHandler } from "./ValSourceFileHandler";
import ts from "typescript";
import { getCompilerOptions } from "./getCompilerOptions";
import { IValFSHost } from "./ValFSHost";
import fs from "fs";
import { SerializedModuleContent } from "./SerializedModuleContent";
import {
  ModuleFilePath,
  ModulePath,
  Internal,
  SourcePath,
  Schema,
  SelectorSource,
  SerializedSchema,
  Source,
  extractValModules,
} from "@valbuild/core";
import path from "path";
import { loadValModules } from "./loadValModules";
import { findNestedJsonValuesRecords } from "./patch/jsonValuesPatch";
import { validateJsonValuesEntries } from "./validateJsonValues";

export type ServiceOptions = {
  /**
   * Disable cache for transpilation
   *
   * @default false
   */
  disableCache?: boolean;
};

export async function createService(
  projectRoot: string,
  opts: ServiceOptions,
  host: IValFSHost = {
    ...ts.sys,
    writeFile: (fileName, data, encoding) => {
      fs.mkdirSync(path.dirname(fileName), { recursive: true });
      fs.writeFileSync(
        fileName,
        typeof data === "string" ? data : new Uint8Array(data),
        encoding,
      );
    },
    rmFile: fs.rmSync,
    readBuffer: (fileName) => {
      try {
        return fs.readFileSync(fileName);
      } catch {
        return undefined;
      }
    },
  },
): Promise<Service> {
  const compilerOptions = getCompilerOptions(projectRoot, host);
  const sourceFileHandler = new ValSourceFileHandler(
    projectRoot,
    compilerOptions,
    host,
  );
  const valModules = loadValModules(projectRoot);
  const extracted = await extractValModules(valModules);
  return new Service(projectRoot, sourceFileHandler, extracted);
}

type ExtractedModules = Awaited<ReturnType<typeof extractValModules>>;

export class Service {
  readonly projectRoot: string;

  constructor(
    projectRoot: string,
    readonly sourceFileHandler: ValSourceFileHandler,
    private readonly extracted: ExtractedModules,
  ) {
    this.projectRoot = projectRoot;
  }

  /**
   * The module file paths that are registered in the project's val.modules.
   */
  getModuleFilePaths(): ModuleFilePath[] {
    return Object.keys(this.extracted.sources) as ModuleFilePath[];
  }

  async get(
    moduleFilePath: ModuleFilePath,
    modulePath: ModulePath,
    options?: { validate: boolean },
  ): Promise<SerializedModuleContent> {
    const opts = options ?? { validate: true };
    const source = this.extracted.sources[moduleFilePath] as Source | undefined;
    const schema = this.extracted.schemas[moduleFilePath] as
      | Schema<SelectorSource>
      | undefined;
    const serializedSchema = this.extracted.serializedSchemas[
      moduleFilePath
    ] as SerializedSchema | undefined;

    const moduleError = this.extracted.moduleErrors.find(
      (e) => e.path === moduleFilePath,
    );

    if (
      source === undefined ||
      schema === undefined ||
      serializedSchema === undefined
    ) {
      return {
        path: moduleFilePath as string as SourcePath,
        errors: {
          invalidModulePath: moduleFilePath,
          fatal: [
            {
              message:
                moduleError?.message ??
                `Module '${moduleFilePath}' was not found in val.modules`,
            },
          ],
        },
      };
    }

    let validation = opts.validate
      ? schema["executeValidate"](
          moduleFilePath as string as SourcePath,
          source as SelectorSource,
        )
      : false;

    // `.jsonValues()` needs two checks that `executeValidate` structurally
    // cannot do, and this is the ONLY place the Service-based callers (the CLI's
    // `val validate`, chiefly) can get them. `ValOps` — the Studio's path — has
    // its own copies; without these, `val validate` reports a module with broken
    // entry content, or an unsupported nested `.jsonValues()`, as VALID, and CI
    // gates on that.
    let jsonValuesModuleError: string | undefined;
    if (opts.validate) {
      const nested = findNestedJsonValuesRecords(serializedSchema);
      if (nested.length > 0) {
        // Root-only is a hard contract (see findNestedJsonValuesRecords): a
        // nested one would silently get NO content validation, which is exactly
        // the failure this check exists to prevent.
        jsonValuesModuleError = `Nested .jsonValues() records are not supported: ${nested
          .map((nestedPath) => `'${nestedPath.join(".")}'`)
          .join(
            ", ",
          )} in ${moduleFilePath}. Use .jsonValues() only on a module's root record/router.`;
      } else {
        // Loads every entry's backing `*.val.json` through its thunk. That is the
        // accepted cost of having no revalidation token (locked decision #3):
        // validation is allowed to be slower at scale, but it is not allowed to
        // silently skip content.
        const entryErrors = await validateJsonValuesEntries(
          schema,
          source,
          moduleFilePath,
        );
        if (Object.keys(entryErrors).length > 0) {
          validation = { ...(validation || {}), ...entryErrors };
        }
      }
    }

    const resolved = Internal.resolvePath(modulePath, source, serializedSchema);
    const sourcePath = (
      resolved.path ? [moduleFilePath, resolved.path].join(".") : moduleFilePath
    ) as SourcePath;

    if (!validation && !moduleError && !jsonValuesModuleError) {
      return {
        path: sourcePath,
        source: resolved.source,
        schema: resolved.schema,
        errors: false,
      };
    }
    const fatal: { message: string }[] = [];
    if (moduleError) {
      fatal.push({ message: moduleError.message });
    }
    if (jsonValuesModuleError) {
      fatal.push({ message: jsonValuesModuleError });
    }
    return {
      path: sourcePath,
      source: resolved.source,
      schema: resolved.schema,
      errors: {
        validation: validation || undefined,
        fatal: fatal.length > 0 ? fatal : undefined,
      },
    };
  }

  async patch(moduleFilePath: ModuleFilePath, patch: Patch): Promise<void> {
    await patchValFile(
      moduleFilePath,
      this.projectRoot,
      patch,
      this.sourceFileHandler,
    );
  }

  dispose() {
    // No-op: the vm-based loader holds no disposable resources.
  }
}

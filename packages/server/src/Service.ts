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

    const validation = opts.validate
      ? schema["executeValidate"](
          moduleFilePath as string as SourcePath,
          source as SelectorSource,
        )
      : false;

    const resolved = Internal.resolvePath(modulePath, source, serializedSchema);
    const sourcePath = (
      resolved.path ? [moduleFilePath, resolved.path].join(".") : moduleFilePath
    ) as SourcePath;

    if (!validation && !moduleError) {
      return {
        path: sourcePath,
        source: resolved.source,
        schema: resolved.schema,
        errors: false,
      };
    }
    return {
      path: sourcePath,
      source: resolved.source,
      schema: resolved.schema,
      errors: {
        validation: validation || undefined,
        fatal: moduleError ? [{ message: moduleError.message }] : undefined,
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

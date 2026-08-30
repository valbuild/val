import { patchValFile } from "./patchValFile";
import {
  applyPatch,
  deepClone,
  JSONOps,
  JSONValue,
  Patch,
} from "@valbuild/core/patch";
import { result } from "@valbuild/core/fp";
import { ValSourceFileHandler } from "./ValSourceFileHandler";
import ts from "typescript";
import { getCompilerOptions } from "./getCompilerOptions";
import { IValFSHost } from "./ValFSHost";
import fs from "fs";
import { SerializedModuleContent } from "./SerializedModuleContent";
import {
  type Json,
  ModuleFilePath,
  ModulePath,
  Internal,
  SourcePath,
  Schema,
  SelectorSource,
  SerializedSchema,
  Source,
  SourceObject,
  extractValModules,
  ValidationError,
} from "@valbuild/core";
import path from "path";
import { loadValModules } from "./loadValModules";
import {
  classifyJsonValuesOp,
  findNestedJsonValuesRecords,
  rebaseContentOp,
  type JsonValuesOpClass,
} from "./patch/jsonValuesPatch";
import { validateJsonValuesEntries } from "./validateJsonValues";
import { findJsonEntryFilePath } from "./jsonEntryLocation";
import { getSyntheticContainingPath } from "./getSyntheticContainingPath";

const jsonOps = new JSONOps();

/**
 * Substitutes loaded `.jsonValues()` entry content back into a module's root
 * record, in place of the `c.json(...)` markers the `.val.ts` holds.
 *
 * Only entries that actually loaded are replaced: an entry whose file is missing
 * or unparseable keeps its marker, so the failure stays visible as the
 * validation error it already produced rather than becoming a silent `undefined`
 * further down.
 */
function withLoadedJsonEntries(
  source: Source,
  loadedEntries: Record<string, Json>,
): Source {
  if (Object.keys(loadedEntries).length === 0) {
    return source;
  }
  if (!isSourceObject(source)) {
    return source;
  }
  return { ...source, ...loadedEntries };
}

/** A non-null, non-array source object: the shape a record/router source has. */
function isSourceObject(source: Source): source is SourceObject {
  return (
    typeof source === "object" && source !== null && !Array.isArray(source)
  );
}

export async function createService(
  projectRoot: string,
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
  // Read val.modules (and everything it imports) through the same host, so an
  // embedder that overlays unsaved editor buffers evaluates what the user sees.
  const valModules = loadValModules(projectRoot, host);
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

  private serializedSchemaOf(
    moduleFilePath: ModuleFilePath,
  ): SerializedSchema | undefined {
    return this.extracted.serializedSchemas[moduleFilePath] as
      | SerializedSchema
      | undefined;
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
    const serializedSchema = this.serializedSchemaOf(moduleFilePath);

    const moduleError = this.extracted.moduleErrors.find(
      (e) => e.path === moduleFilePath,
    );
    // A module whose `def()` threw is recorded WITHOUT a path: the import never
    // got far enough to reveal one, so it cannot be matched above. Those errors
    // are precisely why a module can be missing here, so report them too -
    // "was not found in val.modules" alone sends the reader hunting for a
    // registration that is already there.
    const unattributedModuleErrors = this.extracted.moduleErrors.filter(
      (e) => e.path === undefined,
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
          fatal: moduleError
            ? [{ message: moduleError.message }]
            : [
                {
                  message: `Module '${moduleFilePath}' was not found in val.modules`,
                },
                ...unattributedModuleErrors.map((e) => ({
                  message: e.message,
                })),
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
    // The source as it is on disk holds a `c.json(...)` marker for every
    // `.jsonValues()` entry, and validation reports errors at paths INSIDE those
    // entries. Resolving such a path against the marker source is impossible —
    // it throws — so the loaded content is substituted back in before anything
    // downstream (the `val validate --fix` handlers, chiefly) tries.
    let resolvedFromSource = source;
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
        const { errors: entryErrors, loadedEntries } =
          await validateJsonValuesEntries(schema, source, moduleFilePath);
        resolvedFromSource = withLoadedJsonEntries(source, loadedEntries);
        if (Object.keys(entryErrors).length > 0) {
          // Concatenate per path, never overwrite: an entry written inline is
          // reported BOTH by the record-level validation (which checks the
          // inline value against the item schema) and here (which reports the
          // inlining itself). A spread would drop whichever came first, hiding
          // a real content error behind the inlining error or vice versa.
          const merged: Record<SourcePath, ValidationError[]> = {
            ...(validation || {}),
          };
          for (const [entryPathS, errs] of Object.entries(entryErrors)) {
            const entryPath = entryPathS as SourcePath;
            merged[entryPath] = (merged[entryPath] || []).concat(errs);
          }
          validation = merged;
        }
      }
    }

    const resolved = Internal.resolvePath(
      modulePath,
      resolvedFromSource,
      serializedSchema,
    );
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

  /**
   * Applies a patch to a module's files.
   *
   * A `.jsonValues()` entry's content is not in the `.val.ts` — that file holds
   * only `c.json(() => import("./x.val.json"))` — so an op whose path descends
   * into an entry has to be replayed against the backing `*.val.json` instead.
   * That routing is the same one the Studio's commit flow does in
   * `ValOps.prepare`; both classify with {@link classifyJsonValuesOp} and rebase
   * with {@link rebaseContentOp}, so a CLI fix and a Studio publish write the
   * same file the same way.
   */
  async patch(moduleFilePath: ModuleFilePath, patch: Patch): Promise<void> {
    const serializedSchema = this.serializedSchemaOf(moduleFilePath);
    const valTsOps: Patch = [];
    const entryOps = new Map<string, Patch>();
    for (const op of patch) {
      const cls: JsonValuesOpClass = serializedSchema
        ? classifyJsonValuesOp(serializedSchema, op.path)
        : { kind: "normal" };
      if (cls.kind === "normal") {
        valTsOps.push(op);
        continue;
      }
      if (cls.recordPath.length > 0) {
        // Nested `.jsonValues()` is rejected as a module error before any fix
        // runs, so reaching here means the contract moved without this moving
        // with it. Refuse rather than write to the wrong file.
        throw Error(
          `Cannot patch a nested .jsonValues() record in ${moduleFilePath}: only a root record/router is supported`,
        );
      }
      if (cls.subPath.length === 0) {
        // Adding, removing or replacing a whole entry means writing the
        // `*.val.json` AND rewriting the `c.json(...)` reference in the
        // `.val.ts`. Nothing that reaches `Service.patch` produces those today
        // (`val validate --fix` only ever corrects values inside an entry), and
        // silently applying it to the `.val.ts` alone would leave the module
        // pointing at a file that does not exist.
        throw Error(
          `Cannot ${op.op} the whole .jsonValues() entry '${cls.entryKey}' of ${moduleFilePath} through Service.patch: only edits INSIDE an entry are supported`,
        );
      }
      const ops = entryOps.get(cls.entryKey);
      if (ops) {
        ops.push(op);
      } else {
        entryOps.set(cls.entryKey, [op]);
      }
    }
    // When nothing is routed away, hand the patch over untouched: an empty
    // `valTsOps` would otherwise rewrite the `.val.ts` for no reason.
    if (entryOps.size === 0) {
      await patchValFile(
        moduleFilePath,
        this.projectRoot,
        patch,
        this.sourceFileHandler,
      );
      return;
    }
    if (valTsOps.length > 0) {
      await patchValFile(
        moduleFilePath,
        this.projectRoot,
        valTsOps,
        this.sourceFileHandler,
      );
    }
    for (const [entryKey, ops] of entryOps) {
      this.patchJsonValuesEntry(moduleFilePath, entryKey, ops);
    }
  }

  /** Replays content ops against one `.jsonValues()` entry's `*.val.json`. */
  private patchJsonValuesEntry(
    moduleFilePath: ModuleFilePath,
    entryKey: string,
    ops: Patch,
  ): void {
    const valTsPath = this.sourceFileHandler.resolveSourceModulePath(
      getSyntheticContainingPath(this.projectRoot),
      `.${moduleFilePath
        .replace(".val.ts", ".val")
        .replace(".val.js", ".val")
        .replace(".val.jsx", ".val")
        .replace(".val.tsx", ".val")}`,
    );
    const sourceFile = this.sourceFileHandler.getSourceFile(valTsPath);
    if (!sourceFile) {
      throw Error(`Source file ${valTsPath} not found`);
    }
    // The import specifier is authoritative, not the derived path: entries may
    // be hand-placed (hybrid authoring), so deriving would write a file the
    // module does not read.
    const jsonPath = findJsonEntryFilePath(
      moduleFilePath,
      sourceFile,
      entryKey,
    );
    if (!jsonPath) {
      throw Error(
        `Could not find the '*.val.json' backing .jsonValues() entry '${entryKey}' of ${moduleFilePath}`,
      );
    }
    const absoluteJsonPath = path.join(this.projectRoot, jsonPath);
    const text = this.sourceFileHandler.host.readFile(absoluteJsonPath);
    if (text === undefined) {
      throw Error(`Could not read jsonValues entry file: ${jsonPath}`);
    }
    let content: JSONValue;
    try {
      content = JSON.parse(text);
    } catch (err) {
      throw new Error(`Could not parse jsonValues entry file ${jsonPath}`, {
        cause: err,
      });
    }
    for (const op of ops) {
      // Root record / router only, so the prefix is exactly the entry key.
      const rebased = rebaseContentOp(op, 1);
      if (result.isErr(rebased)) {
        throw Error(
          `Could not apply ${op.op} to jsonValues entry '${entryKey}' of ${moduleFilePath}: ${rebased.error.message}`,
        );
      }
      const applied = applyPatch(deepClone(content), jsonOps, [rebased.value]);
      if (result.isErr(applied)) {
        throw Error(
          `Could not apply ${op.op} to ${jsonPath}: ${applied.error.message}`,
        );
      }
      content = applied.value;
    }
    this.sourceFileHandler.writeFile(
      absoluteJsonPath,
      JSON.stringify(content, null, 2) + "\n",
      "utf8",
    );
  }

  dispose() {
    // No-op: the vm-based loader holds no disposable resources.
  }
}

import path from "path";
import picocolors from "picocolors";
import { glob } from "fast-glob";
import { DEFAULT_CONTENT_HOST, DEFAULT_VAL_REMOTE_HOST } from "@valbuild/core";
import { getSettings, uploadRemoteFile } from "@valbuild/server";
import { formatFixedFiles } from "./formatFixedFiles";
import { findAndEvalValConfigFile } from "./utils/evalValConfigFile";
import { createDefaultValFSHost, runValidation } from "./runValidation";
import {
  sourcePathToCodeFrame,
  sourcePathToLocationParts,
  type SourceFileCache,
} from "./utils/sourcePathToFileLocation";

type Diagnostic =
  | {
      // Both are errors (✘) and count towards the exit code; "fixable" adds
      // "run --fix".
      severity: "fixable" | "error";
      sourcePath: string;
      message: string;
      keyError?: boolean;
    }
  | {
      // ⚠: printed, grouped by message, and counted only under --strict.
      severity: "warning";
      sourcePath: string;
      message: string;
      files: string[];
      hint?: string;
      keyError?: boolean;
    };

type WarningDiagnostic = Extract<Diagnostic, { severity: "warning" }>;

/** How many of a warning group's files are listed before "… N more". */
const WARNING_FILES_SHOWN = 5;

type ModuleReport = {
  // Relative file path (no leading slash).
  file: string;
  durationMs: number;
  diagnostics: Diagnostic[];
};

export async function validate({
  root,
  fix,
  watch,
  strict,
}: {
  root?: string;
  fix?: boolean;
  watch?: boolean;
  /** Fail on warnings too. */
  strict?: boolean;
}) {
  const projectRoot = root ? path.resolve(root) : process.cwd();

  let prettier: typeof import("prettier") | undefined;
  try {
    prettier = await import("prettier");
  } catch {
    console.log("Prettier not found, skipping formatting");
  }

  const runOnce = () =>
    validateOnce({
      projectRoot,
      fix: !!fix,
      prettier,
      ...(strict ? { strict: true } : {}),
    });

  if (!watch) {
    const totalErrors = await runOnce();
    if (totalErrors > 0) {
      process.exit(1);
    }
    return;
  }

  await watchAndValidate(projectRoot, runOnce);
}

/**
 * One validation pass over the project, printed as `val validate` prints it,
 * returning the number of errors found -- and of warnings, under `strict`.
 *
 * Re-reads config and val files on each call so it always reflects the latest
 * state on disk: `val validate` calls it once or on every change (`--watch`),
 * and `val publish` calls it before it builds anything.
 */
export async function validateOnce({
  projectRoot,
  fix,
  prettier,
  blockingOnly = false,
  strict = false,
}: {
  projectRoot: string;
  fix: boolean;
  /** Formats the files a fix rewrote. Absent: they are left as written. */
  prettier?: typeof import("prettier");
  /**
   * Count only the errors that would hold a publish back in the Studio, not
   * the ones it leaves to the server to repair on save (`isRepairedOnSave`):
   * what `val publish` refuses on. Every error is still printed.
   */
  blockingOnly?: boolean;
  /**
   * Count warnings as errors (`--strict`). A warning is a local file in a
   * project that stores files remotely: see `WARNING_FIXES` in
   * `@valbuild/shared`.
   */
  strict?: boolean;
}): Promise<number> {
  const valConfigFile = await findAndEvalValConfigFile(projectRoot);

  const resolvedValConfigFile = valConfigFile
    ? {
        ...valConfigFile,
        project: process.env.VAL_PROJECT || valConfigFile.project,
      }
    : process.env.VAL_PROJECT
      ? { project: process.env.VAL_PROJECT }
      : undefined;

  console.log(
    picocolors.greenBright(
      `Validating project${resolvedValConfigFile?.project ? ` '${picocolors.inverse(resolvedValConfigFile.project)}'` : ""}...`,
    ),
  );

  const valFiles: string[] = await glob("**/*.val.{js,jsx,ts,tsx}", {
    ignore: ["node_modules/**"],
    cwd: projectRoot,
  });

  console.log(picocolors.greenBright(`Found ${valFiles.length} files...`));

  const fixedFiles = new Set<string>();
  let totalErrors = 0;
  let totalWarnings = 0;
  let repairedOnSave = 0;

  // Caches each val file's parsed source so files are read/parsed at most once
  // per pass when resolving sourcePaths to file locations and code frames.
  const sourceFileCache: SourceFileCache = new Map();

  // Diagnostics are buffered per module (keyed by relative file path) so we can
  // render them grouped and prioritised after the run, rather than streaming
  // them out interleaved. Transient progress (remote/fix-applied) still streams
  // live below.
  const reports = new Map<string, ModuleReport>();
  const valid: { file: string; durationMs: number }[] = [];
  const skipped: string[] = [];

  // Relative file path (no leading slash), matching the code frame's
  // relativeFile so headers, diagnostics and frames all agree.
  const relFile = (file: string) => file.replace(/^\//, "");
  // The module a sourcePath/file belongs to is the part before the `?p=...`.
  const moduleOf = (sourcePathOrFile: string) =>
    relFile(sourcePathOrFile.split("?")[0]);

  const reportFor = (file: string): ModuleReport => {
    const key = relFile(file);
    let report = reports.get(key);
    if (!report) {
      report = { file: key, durationMs: 0, diagnostics: [] };
      reports.set(key, report);
    }
    return report;
  };

  for await (const event of runValidation({
    root: projectRoot,
    fix,
    valFiles,
    project: resolvedValConfigFile?.project,
    remote: {
      remoteHost: process.env.VAL_REMOTE_HOST || DEFAULT_VAL_REMOTE_HOST,
      getSettings: (projectName, options) => getSettings(projectName, options),
      uploadFile: (project, bucket, fileHash, fileExt, fileBuffer, options) =>
        uploadRemoteFile(
          process.env.VAL_CONTENT_URL || DEFAULT_CONTENT_HOST,
          project,
          bucket,
          fileHash,
          fileExt ?? "",
          fileBuffer,
          options,
        ),
    },
    fs: createDefaultValFSHost(),
  })) {
    switch (event.type) {
      case "file-valid":
        // No errors, but it may have warnings: then it is shown with them.
        if (reports.has(relFile(event.file))) {
          reportFor(event.file).durationMs = event.durationMs;
        } else {
          valid.push({
            file: relFile(event.file),
            durationMs: event.durationMs,
          });
        }
        break;
      case "file-error-count":
        reportFor(event.file).durationMs = event.durationMs;
        totalErrors += event.errorCount;
        break;
      case "validation-error":
        if (event.repairedOnSave) repairedOnSave += 1;
        reportFor(moduleOf(event.sourcePath)).diagnostics.push({
          severity: "error",
          sourcePath: event.sourcePath,
          message: event.message,
          ...(event.keyError ? { keyError: true } : {}),
        });
        break;
      case "validation-fixable-error":
        if (event.repairedOnSave) repairedOnSave += 1;
        reportFor(moduleOf(event.sourcePath)).diagnostics.push({
          severity: event.fixable ? "fixable" : "error",
          sourcePath: event.sourcePath,
          message: event.message,
          ...(event.keyError ? { keyError: true } : {}),
        });
        break;
      case "validation-warning":
        totalWarnings += 1;
        reportFor(moduleOf(event.sourcePath)).diagnostics.push({
          severity: "warning",
          sourcePath: event.sourcePath,
          message: event.message,
          files: event.files,
          ...(event.hint !== undefined ? { hint: event.hint } : {}),
          ...(event.keyError ? { keyError: true } : {}),
        });
        break;
      case "unknown-fix":
        reportFor(moduleOf(event.sourcePath)).diagnostics.push({
          severity: "error",
          sourcePath: event.sourcePath,
          message: `Unknown fix: ${event.fixes.join(", ")}`,
          ...(event.keyError ? { keyError: true } : {}),
        });
        break;
      case "unregistered-module":
        skipped.push(event.file);
        break;
      case "fatal-error":
        // No sourcePath for fatal errors; group by file, render message only.
        reportFor(event.file).diagnostics.push({
          severity: "error",
          sourcePath: event.file,
          message: event.message,
        });
        break;
      case "fix-applied":
        console.log(
          picocolors.yellow("⚠"),
          "Applied fix for",
          event.sourcePath,
        );
        fixedFiles.add(event.file);
        break;
      case "remote-uploading":
        console.log(
          picocolors.yellow("⚠"),
          `Uploading remote file: '${event.ref}'...`,
        );
        break;
      case "remote-uploaded":
        console.log(
          picocolors.green("✔"),
          `Completed upload of remote file: '${event.ref}'`,
        );
        break;
      case "remote-already-uploaded":
        console.log(
          picocolors.yellow("⚠"),
          `Remote file ${event.filePath} already uploaded`,
        );
        break;
      case "remote-downloading":
        console.log(
          picocolors.yellow("⚠"),
          `Downloading remote file in ${event.sourcePath}...`,
        );
        break;
      case "summary-errors":
      case "summary-success":
        break;
    }
  }

  // Renders a module's diagnostics under a single left "│" gutter bar, with the
  // file name on top and blank gutter lines for air. Output flows least- to
  // most-actionable top-to-bottom: warnings first, then errors, and fixable
  // errors last (at the bottom, nearest the prompt).
  const renderModule = (report: ModuleReport) => {
    const bar = picocolors.dim("│");
    const rank: Record<Diagnostic["severity"], number> = {
      warning: 0,
      error: 1,
      fixable: 2,
    };
    const diagnostics = [...report.diagnostics].sort(
      (a, b) => rank[a.severity] - rank[b.severity],
    );
    const warningCount = diagnostics.filter(
      (d) => d.severity === "warning",
    ).length;
    const fixableCount = diagnostics.filter(
      (d) => d.severity === "fixable",
    ).length;
    const errorCount = diagnostics.length - warningCount;
    const symbol =
      errorCount > 0 ? picocolors.red("✘") : picocolors.yellow("⚠");
    const labels: string[] = [];
    if (errorCount > 0) {
      labels.push(
        `${errorCount} error${errorCount > 1 ? "s" : ""}${
          fixableCount > 0 ? ` (${fixableCount} fixable)` : ""
        }`,
      );
    }
    if (warningCount > 0) {
      labels.push(`${warningCount} warning${warningCount > 1 ? "s" : ""}`);
    }
    console.log(
      `${picocolors.bold(report.file)}  ${symbol} ${labels.join(" · ")}  ${picocolors.dim(
        `(${report.durationMs}ms)`,
      )}`,
    );
    const locationOf = (d: Diagnostic) =>
      sourcePathToLocationParts(
        d.sourcePath,
        projectRoot,
        sourceFileCache,
        d.keyError ? "key" : "value",
      );

    // Warnings say the same thing about many values (every local image in a
    // gallery), so each message is printed once, over the places it is about.
    const warningGroups = new Map<string, WarningDiagnostic[]>();
    for (const d of diagnostics) {
      if (d.severity !== "warning") continue;
      const group = warningGroups.get(d.message);
      if (group) {
        group.push(d);
      } else {
        warningGroups.set(d.message, [d]);
      }
    }
    for (const [message, group] of warningGroups) {
      console.log(bar);
      console.log(`${bar}  ${picocolors.yellow("⚠")}  ${message}`);
      console.log(bar);
      for (const d of group.slice(0, WARNING_FILES_SHOWN)) {
        const parts = locationOf(d);
        const files = d.files.join(", ");
        // `file:line:col` first, so VS Code's terminal links it.
        const where = parts
          ? `${parts.relativeFile}:${parts.line}:${parts.character}`
          : d.sourcePath;
        console.log(`${bar}     ${where}  ${picocolors.dim(files)}`);
      }
      if (group.length > WARNING_FILES_SHOWN) {
        console.log(
          `${bar}     ${picocolors.dim(
            `… ${group.length - WARNING_FILES_SHOWN} more`,
          )}`,
        );
      }
      const hint = group.find((d) => d.hint !== undefined)?.hint;
      if (hint !== undefined) {
        console.log(bar);
        console.log(`${bar}     ${picocolors.dim(`→ ${hint}`)}`);
      }
    }

    for (const d of diagnostics) {
      if (d.severity === "warning") continue;
      const parts = locationOf(d);
      const dsym = picocolors.red("✘");
      console.log(bar);
      if (parts) {
        // `file:line:col` (no key/value label) so VS Code's terminal links it.
        console.log(
          `${bar}  ${dsym}  ${parts.relativeFile}:${parts.line}:${parts.character}`,
        );
        console.log(`${bar}     ${d.message}`);
      } else {
        console.log(`${bar}  ${dsym}  ${d.message}`);
      }
      const frame = sourcePathToCodeFrame(
        d.sourcePath,
        projectRoot,
        sourceFileCache,
        d.keyError ? "key" : "value",
      );
      if (frame !== undefined) {
        console.log(bar);
        for (const frameLine of frame.split("\n")) {
          console.log(`${bar}     ${frameLine}`);
        }
      }
      if (d.severity === "fixable") {
        console.log(
          `${bar}     ${picocolors.dim("→ run with --fix to apply")}`,
        );
      }
    }
    console.log(bar);
    console.log("");
  };

  // Format the files that had fixes applied, the way the project formats
  // everything else. See `formatFixedFiles` for why this cannot simply be
  // `prettier.format(code, { filepath })`.
  //
  // A file that could not be formatted is reported and skipped rather than
  // thrown: the fix itself landed, and aborting here would leave the fix
  // applied and the report below unwritten.
  if (prettier) {
    const { failures } = await formatFixedFiles(
      prettier,
      projectRoot,
      fixedFiles,
    );
    for (const failure of failures) {
      console.log(
        picocolors.yellow("⚠"),
        `Could not format ${relFile(failure.file)}: ${failure.message}`,
      );
    }
  }

  // Render the grouped report least- to most-actionable, top-to-bottom, so the
  // most important things end up at the bottom nearest the prompt: valid files
  // and skipped modules first, then warning-only modules, then error-only
  // modules, then fixable modules.
  const allReports = [...reports.values()];
  const hasErrors = (r: ModuleReport) =>
    r.diagnostics.some((d) => d.severity !== "warning");
  const warningModules = allReports.filter((r) => !hasErrors(r));
  const fixableModules = allReports.filter((r) =>
    r.diagnostics.some((d) => d.severity === "fixable"),
  );
  const errorModules = allReports.filter(
    (r) => hasErrors(r) && !r.diagnostics.some((d) => d.severity === "fixable"),
  );

  for (const v of valid) {
    console.log(
      picocolors.green("✔"),
      picocolors.dim(`${v.file}  valid (${v.durationMs}ms)`),
    );
  }
  for (const file of skipped) {
    console.log(
      picocolors.yellow("⚠"),
      picocolors.dim(`/${file} is not registered in val.modules - skipping`),
    );
  }

  if (allReports.length > 0) {
    console.log("");
  }
  for (const report of [
    ...warningModules,
    ...errorModules,
    ...fixableModules,
  ]) {
    renderModule(report);
  }

  const fixableTotal = allReports.reduce(
    (n, r) => n + r.diagnostics.filter((d) => d.severity === "fixable").length,
    0,
  );
  const errorFiles = allReports.filter(hasErrors).length;
  const warningFiles = allReports.filter((r) =>
    r.diagnostics.some((d) => d.severity === "warning"),
  ).length;
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? "" : "s"}`;
  const warnings = `${plural(totalWarnings, "warning")} in ${plural(warningFiles, "file")}`;
  const warningPart =
    totalWarnings > 0
      ? `${warnings}${strict ? ", which --strict counts as errors" : ""}`
      : undefined;
  const tail = [
    ...(valid.length > 0 ? [`${valid.length} valid`] : []),
    ...(skipped.length > 0 ? [`${skipped.length} skipped`] : []),
  ];
  if (totalErrors > 0) {
    let summary = plural(totalErrors, "error");
    if (fixableTotal > 0) {
      summary += ` (${fixableTotal} fixable)`;
    }
    summary += ` across ${plural(errorFiles, "file")}`;
    console.log(
      picocolors.red("✘"),
      [summary, ...(warningPart ? [warningPart] : []), ...tail].join(" · "),
    );
  } else if (warningPart && strict) {
    // Not "No validation errors" beside a ✘: under --strict this run failed,
    // and the warnings are why.
    console.log(
      picocolors.red("✘"),
      [`${warnings}, and --strict fails on warnings`, ...tail].join(" · "),
    );
  } else if (warningPart) {
    console.log(
      picocolors.green("✔"),
      ["No validation errors", warningPart, ...tail].join(" · "),
    );
  } else {
    console.log(
      picocolors.green("✔"),
      ["No validation errors found", ...tail].join(" · "),
    );
  }
  const errors = blockingOnly ? totalErrors - repairedOnSave : totalErrors;
  return strict ? errors + totalWarnings : errors;
}

// Directory names anywhere in the path that should never be watched.
const WATCH_IGNORED = /(^|[\\/])(node_modules|\.git|dist)([\\/]|$)/;

function isRelevantValFile(filePath: string): boolean {
  const base = path.basename(filePath);
  return (
    base === "val.modules.ts" ||
    base === "val.modules.js" ||
    base === "val.config.ts" ||
    base === "val.config.js" ||
    /\.val\.(ts|js)$/.test(base)
  );
}

async function watchAndValidate(
  projectRoot: string,
  runOnce: () => Promise<number>,
) {
  // Initial pass.
  await runOnce();
  const watchingMessage = picocolors.dim(
    "Watching for changes... (Ctrl+C to exit)",
  );
  console.log(watchingMessage);

  // chokidar 5 is ESM-only; load it dynamically (like prettier above).
  const { watch } = await import("chokidar");

  let running = false;
  let pending = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const triggerRun = async () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    // Clear the screen (and scrollback) so only the latest result shows.
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
    console.log(picocolors.cyanBright("Re-validating..."));
    try {
      await runOnce();
    } catch (err) {
      console.error(err);
    }
    console.log(watchingMessage);
    running = false;
    if (pending) {
      pending = false;
      void triggerRun();
    }
  };

  const watcher = watch(projectRoot, {
    ignoreInitial: true,
    ignored: (watchedPath: string) => WATCH_IGNORED.test(watchedPath),
  });

  watcher.on("all", (_event, changedPath) => {
    if (!isRelevantValFile(changedPath)) {
      return;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => void triggerRun(), 150);
  });

  process.on("SIGINT", () => {
    void watcher.close().then(() => process.exit(0));
  });
}

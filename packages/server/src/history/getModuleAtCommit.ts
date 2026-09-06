import { result } from "@valbuild/core/fp";
import type { ModuleFilePath } from "@valbuild/core";
import { SerializedSchema } from "@valbuild/shared/internal";
import { fromError as fromZodError } from "zod-validation-error";
import type { ValOps } from "../ValOps";
import type { HistoryError } from "./HistoryError";
import type { HistoricalModule } from "./types";

/**
 * One module, as of a commit — including a commit that never touched it.
 *
 * `getHistoricalPatchSet` answers "what did this commit change", which is what
 * a commit IS. This answers "how did this module look at that point", which is
 * what someone comparing two panes is asking as soon as they navigate off the
 * changed set — and without it the history pane can only show a handful of
 * modules per commit.
 *
 * `null` means history has no record at or before that commit: the module was
 * last edited before recording started, or never. That is deliberately NOT the
 * same as a module the commit deleted, which is a recorded fact with a source
 * of `null`, and not the same as an error.
 */
export async function getModuleAtCommit(
  ops: ValOps,
  commitSha: string,
  moduleFilePath: ModuleFilePath,
): Promise<result.Result<HistoricalModule | null, HistoryError>> {
  const res = await ops.getCommitModules(commitSha, {
    asOf: true,
    moduleFilePath,
  });
  if (result.isErr(res)) {
    return res;
  }
  const version = res.value.modules.find(
    (module) => module.moduleFilePath === moduleFilePath,
  );
  if (version === undefined) {
    return result.ok(null);
  }
  if (version.unavailable) {
    return result.ok({
      source: null,
      schema: null,
      patchIds: [],
      changedPaths: [],
      failures: [{ kind: "source-unavailable", moduleFilePath }],
    });
  }
  // Validated here, not at the transport boundary, for the same reason as in
  // `getHistoricalPatchSet`: a schema this Val cannot read is one module it
  // cannot show, not a failed request.
  const schemaRes = SerializedSchema.safeParse(version.schema);
  if (!schemaRes.success) {
    return result.ok({
      source: version.source,
      schema: null,
      patchIds: [],
      changedPaths: [],
      failures: [
        {
          kind: "schema-unreadable",
          moduleFilePath,
          message: fromZodError(schemaRes.error).toString(),
        },
      ],
    });
  }
  return result.ok({
    source: version.source,
    schema: schemaRes.data,
    // Empty, and correct: this module may well have been changed by an EARLIER
    // commit than the one asked about, and those are that commit's patches.
    patchIds: [],
    changedPaths: [],
    failures: [],
  });
}

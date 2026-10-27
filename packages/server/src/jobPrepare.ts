import type { PreparedCommit } from "./ValOps";

/**
 * A publish job's prepare, split into what the tab builds and what content
 * archives.
 *
 * A job's content is its base plus every change it took (valbuild/home,
 * docs/app-mode.md, "Publishing is a queued job"). The server has two
 * `prepare`s to hand: `chainOnly` -- this build's embedded source with every
 * commit since applied, which is the branch's head -- and `withJob`, the same
 * with the job's pending changes on top. Anything applied since the job
 * started came out of the job's own change set, so `withJob` IS the job's
 * content; were that ever not so, the seal's containment check would restart
 * the job rather than publish it.
 *
 * - The BUILD needs all of `withJob`'s source files: it is a whole site.
 * - The ARCHIVE is what the commit publishes, so content is sent only what the
 *   job changes: the files whose text differs from the head's, and the modules
 *   and binary files its changes touch. Everything else is the head's, and an
 *   archive that listed it would say this commit changed it.
 *
 * Files are compared rather than derived from module paths because a change to
 * a module can write a file under another path -- a `.val.json` entry of a
 * record -- which only the prepared output knows about.
 */
export function splitJobPrepare(input: {
  chainOnly: Pick<PreparedCommit, "patchedSourceFiles">;
  withJob: Pick<
    PreparedCommit,
    | "patchedSourceFiles"
    | "patchedBinaryFilesDescriptors"
    | "moduleVersions"
    | "appliedPatches"
  >;
  jobPatchIds: readonly string[];
}): {
  /** Every source file of the job's content, for the build. */
  buildSourceFiles: Record<string, string | null>;
  /** What content archives: the job's own changes. */
  archive: {
    patchedSourceFiles: Record<string, string | null>;
    patchedBinaryFilesDescriptors: PreparedCommit["patchedBinaryFilesDescriptors"];
    modules: PreparedCommit["moduleVersions"];
  };
} {
  const job = new Set<string>(input.jobPatchIds);
  const before = input.chainOnly.patchedSourceFiles;
  const after = input.withJob.patchedSourceFiles;

  const patchedSourceFiles: Record<string, string | null> = {};
  for (const [path, text] of Object.entries(after)) {
    if (!(path in before) || before[path] !== text) {
      patchedSourceFiles[path] = text;
    }
  }

  const patchedBinaryFilesDescriptors: PreparedCommit["patchedBinaryFilesDescriptors"] =
    {};
  for (const [path, descriptor] of Object.entries(
    input.withJob.patchedBinaryFilesDescriptors,
  )) {
    if (job.has(descriptor.patchId)) {
      patchedBinaryFilesDescriptors[path] = descriptor;
    }
  }

  // The modules any of the job's changes were applied to.
  const touched = new Set<string>(
    Object.entries(input.withJob.appliedPatches)
      .filter(([, applied]) => applied.some((id) => job.has(id)))
      .map(([path]) => path),
  );
  const modules: PreparedCommit["moduleVersions"] = Object.fromEntries(
    Object.entries(input.withJob.moduleVersions).filter(([path]) =>
      touched.has(path),
    ),
  );

  return {
    buildSourceFiles: after,
    archive: { patchedSourceFiles, patchedBinaryFilesDescriptors, modules },
  };
}

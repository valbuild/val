/**
 * The type errors a project would have after `pnpm install`, computed in
 * memory: the layout from the lockfile, the types its imports reach from
 * adept, and the project's own TypeScript over both (valbuild/home
 * `docs/adept.md`, step 4).
 *
 * Here rather than in the Studio because two callers run it: the Studio, for
 * a proposal that changes dependencies, and home's upgrade page, which pins
 * this package at an exact version so that a site's own Val never reaches
 * its upgrade (valbuild/home `docs/plans/upgrades-v2.md`, piece E). It runs
 * anywhere a module runs; each caller puts it in a worker of its own.
 */
export {
  typecheckProject,
  newErrors,
  layoutOf,
  PROJECT_ROOT,
  type TypecheckInput,
  type TypecheckProgress,
  type TypecheckResult,
  type TypeErrorEntry,
  type ProgramSummary,
} from "./typecheckProject";
export {
  SourceError,
  packageNameOf,
  typesPackageOf,
  type PackageRef,
  type TypesBundle,
  type TypecheckSources,
  type MissingTypes,
  type AcquisitionStats,
} from "./acquireTypes";
export { adeptSources } from "./adeptSources";
export {
  lockedPackages,
  typescriptVersion,
  type Locked,
} from "./lockedVersions";
export { LockfileError } from "./pnpmLockfile";
export { UnsupportedLayoutError } from "./pnpmLayout";
export {
  BUNDLED_TYPESCRIPT,
  CompilerError,
  chooseCompiler,
  type CompilerBundle,
  type CompilerChoice,
} from "./typescriptCompiler";
export {
  MAX_REPORTED_ERRORS,
  errorsByFile,
  reportedError,
  runProposalTypecheck,
  type ProposalTypeError,
  type ProposalTypecheckClient,
  type ProposalTypecheckDeps,
  type ProposalTypecheckOutcome,
  type ProposalTypecheckStep,
} from "./proposalTypecheck";

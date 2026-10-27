/**
 * Which package manager should the new project use?
 *
 * The command that bootstrapped us already tells us: package managers set
 * `npm_config_user_agent` when they run a lifecycle script, so
 * `npm create @valbuild` arrives as "npm/10.9.0 node/v22.11.0 linux x64" and
 * `pnpm create @valbuild` as "pnpm/10.4.1 node/v22.11.0 linux x64". We use
 * that, unless the user overrides it with a flag.
 */

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export const DEFAULT_PACKAGE_MANAGER: PackageManager = "npm";

type PackageManagerCommands = {
  /** Install every dependency in the project directory. */
  install: string;
  /** Run a package.json script, e.g. `${run} dev`. */
  run: string;
  /**
   * Run the Val CLI from the new project, e.g. `${valCli} connect`.
   *
   * pnpm, yarn and bun run the project's own `val` binary and nothing else.
   * npm's `npx` falls back to the registry when the local binary is missing —
   * and `val` there is an unrelated package by that name — so npm names the
   * package it wants explicitly.
   */
  valCli: string;
  /** Lock files this package manager writes, and which therefore may be kept. */
  lockFiles: string[];
};

export const PACKAGE_MANAGER_COMMANDS: Record<
  PackageManager,
  PackageManagerCommands
> = {
  npm: {
    install: "npm install",
    run: "npm run",
    valCli: "npx -p @valbuild/cli val",
    lockFiles: ["package-lock.json", "npm-shrinkwrap.json"],
  },
  pnpm: {
    install: "pnpm install",
    run: "pnpm run",
    valCli: "pnpm exec val",
    lockFiles: ["pnpm-lock.yaml"],
  },
  yarn: {
    install: "yarn",
    run: "yarn",
    valCli: "yarn val",
    lockFiles: ["yarn.lock"],
  },
  bun: {
    install: "bun install",
    run: "bun run",
    valCli: "bun run val",
    lockFiles: ["bun.lock", "bun.lockb"],
  },
};

function isPackageManager(value: string): value is PackageManager {
  return Object.prototype.hasOwnProperty.call(PACKAGE_MANAGER_COMMANDS, value);
}

/**
 * Every package manager we support, derived from the commands above so the two
 * cannot drift: a `PackageManager` added to the union without commands is a
 * type error, and one added with commands shows up in the help text and the
 * error messages for free.
 */
export const PACKAGE_MANAGERS: PackageManager[] = Object.keys(
  PACKAGE_MANAGER_COMMANDS,
).filter(isPackageManager);

/**
 * The package manager that invoked us, or null if we cannot tell.
 *
 * A user agent we do not recognize (a package manager we have no commands for)
 * is the same as no user agent at all: the caller falls back to the default.
 */
export function detectPackageManager(
  userAgent: string | undefined,
): PackageManager | null {
  if (!userAgent) {
    return null;
  }
  const name = userAgent.trim().split(" ")[0].split("/")[0];
  if (isPackageManager(name)) {
    return name;
  }
  return null;
}

export type PackageManagerArgs = {
  /** The package manager the flags asked for, or null if none did. */
  packageManager: PackageManager | null;
  /** The first flag we could not make sense of, verbatim, for the error message. */
  invalidFlag: string | null;
  /** `args` without the package manager flags, so other parsing is unaffected. */
  rest: string[];
};

/**
 * Read `--use-npm` / `--use-pnpm` / `--use-yarn` / `--use-bun` and
 * `--package-manager <name>` (or `--package-manager=<name>`) out of `args`.
 *
 * The last flag wins, so a later `--use-npm` overrides an earlier
 * `--package-manager pnpm` rather than erroring.
 */
export function parsePackageManagerArgs(args: string[]): PackageManagerArgs {
  let packageManager: PackageManager | null = null;
  let invalidFlag: string | null = null;
  const rest: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const useMatch = /^--use-(.+)$/.exec(arg);
    if (useMatch) {
      if (isPackageManager(useMatch[1])) {
        packageManager = useMatch[1];
      } else if (invalidFlag === null) {
        invalidFlag = arg;
      }
      continue;
    }
    if (arg === "--package-manager" || arg === "--pm") {
      const value = args[i + 1];
      if (value !== undefined && isPackageManager(value)) {
        packageManager = value;
      } else if (invalidFlag === null) {
        invalidFlag = value === undefined ? arg : `${arg} ${value}`;
      }
      // Skip the value too, unless the flag was last and has none.
      if (value !== undefined) {
        i++;
      }
      continue;
    }
    const valueMatch = /^--(?:package-manager|pm)=(.*)$/.exec(arg);
    if (valueMatch) {
      if (isPackageManager(valueMatch[1])) {
        packageManager = valueMatch[1];
      } else if (invalidFlag === null) {
        invalidFlag = arg;
      }
      continue;
    }
    rest.push(arg);
  }

  return { packageManager, invalidFlag, rest };
}

export type ResolvedPackageManager = PackageManagerArgs & {
  /** The package manager to actually use. */
  packageManager: PackageManager;
  /** Where the choice came from, so we can say so in the output. */
  source: "flag" | "user-agent" | "default";
};

/** Flags beat the invoking package manager, which beats the default. */
export function resolvePackageManager(
  args: string[],
  userAgent: string | undefined,
): ResolvedPackageManager {
  const parsed = parsePackageManagerArgs(args);
  if (parsed.packageManager) {
    return { ...parsed, packageManager: parsed.packageManager, source: "flag" };
  }
  const detected = detectPackageManager(userAgent);
  if (detected) {
    return { ...parsed, packageManager: detected, source: "user-agent" };
  }
  return {
    ...parsed,
    packageManager: DEFAULT_PACKAGE_MANAGER,
    source: "default",
  };
}

/**
 * Lock files that belong to some *other* package manager.
 *
 * The template repository commits a lock file for one package manager (npm),
 * so a project created with another one has to lose it: pnpm would ignore
 * `package-lock.json` while writing `pnpm-lock.yaml`, leaving two lock files
 * in the tree and only one of them real.
 */
export function foreignLockFiles(packageManager: PackageManager): string[] {
  const own = PACKAGE_MANAGER_COMMANDS[packageManager].lockFiles;
  return PACKAGE_MANAGERS.flatMap(
    (candidate) => PACKAGE_MANAGER_COMMANDS[candidate].lockFiles,
  ).filter((lockFile) => !own.includes(lockFile));
}

/**
 * The versions of the Val packages this project has installed.
 *
 * Each is resolved from the project rather than declared, because the CLI is a
 * dependency of the project and not the other way round — and a project has
 * exactly one framework package, so the one that is absent is absent rather
 * than broken. `undefined` is the honest answer for it.
 */
export const getVersions = (): {
  coreVersion?: string;
  nextVersion?: string;
  tanstackVersion?: string;
} => {
  const coreVersion = requireVersion("@valbuild/core", "core");
  const nextVersion = requireVersion("@valbuild/next", "next");
  const tanstackVersion = requireVersion("@valbuild/tanstack", "tanstack");
  return {
    coreVersion: coreVersion || undefined,
    nextVersion: nextVersion || undefined,
    tanstackVersion: tanstackVersion || undefined,
  };
};

function requireVersion(packageName: string, key: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(packageName)?.Internal?.VERSION?.[key] ?? null;
  } catch {
    return null;
  }
}

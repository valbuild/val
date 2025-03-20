export const getVersions = (): {
  coreVersion?: string;
  nextVersion?: string;
} => {
  const coreVersion = (() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      return require("@valbuild/core")?.Internal?.VERSION?.core;
    } catch {
      return null;
    }
  })();
  const nextVersion = (() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      return require("@valbuild/next")?.Internal?.VERSION?.next;
    } catch {
      return null;
    }
  })();
  return {
    coreVersion: coreVersion || undefined,
    nextVersion: nextVersion || undefined,
  };
};

export const getVersions = async (): Promise<{
  coreVersion?: string;
  nextVersion?: string;
}> => {
  const coreVersion = await (() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return import("@valbuild/core").then(
        (nextLib) => nextLib?.Internal?.VERSION?.core
      );
    } catch {
      return null;
    }
  })();
  const nextVersion = await (() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return import("@valbuild/next").then(
        (nextLib) => nextLib?.Internal?.VERSION?.next
      );
    } catch {
      return null;
    }
  })();
  return {
    coreVersion: coreVersion || undefined,
    nextVersion: nextVersion || undefined,
  };
};

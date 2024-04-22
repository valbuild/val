export const VERSION = ((): string | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("../package.json").version;
  } catch {
    return null;
  }
})();

export const VERSION = ((): string | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("../package.json").version;
  } catch {
    return null;
  }
})();

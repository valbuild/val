export const VERSION = ((): string | null => {
  try {
     
    return require("../package.json").version;
  } catch {
    return null;
  }
})();

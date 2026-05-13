/** @type {import("jest").Config} */
module.exports = {
  preset: "../../jest.preset",
  moduleNameMapper: {
    // The runtime wrapper at src/internal/typescript.ts uses
    // `createRequire(import.meta.url)` to keep the `typescript` import opaque
    // to bundlers. Jest evaluates source as CJS where `import.meta` is a
    // syntax error, so redirect tests to import `typescript` directly.
    "(^|/)internal/typescript$": "typescript",
  },
};

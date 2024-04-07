// eslint-disable-next-line @typescript-eslint/no-var-requires
const { default: dts } = require("rollup-plugin-dts");

/**
 * This rollup config is used solely for bundling type definitions. Vite builds
 * the rest!
 *
 * @type{import("rollup").RollupOptions[]}
 */
const config = [
  {
    input: "./src/vite-index.ts",
    output: [{ file: "dist/valbuild-ui.cjs.d.ts", format: "es" }],
    plugins: [dts()],
  },
  {
    input: "./src/vite-server.ts",
    output: [{ file: "server/dist/valbuild-ui-server.cjs.d.ts", format: "es" }],
    plugins: [dts()],
  },
];

module.exports = config;

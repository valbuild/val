// We use this to inject the package version into the build output
// We want to use Vite / rollup to do this, but ran out of time and patience to do it

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");
const packageJson = require("./package.json");
const {
  replaceVersionPlaceholder,
  assertNoPlaceholdersLeft,
  VERSION_MARKER,
} = require("./buildPlaceholders");

const files = [
  "dist/valbuild-ui.esm.js",
  "dist/valbuild-ui.cjs.js",
  "server/dist/valbuild-ui-server.esm.js",
  "server/dist/valbuild-ui-server.cjs.js",
];
const version = packageJson.version;

for (const targetFile of files) {
  const filePath = path.join(__dirname, targetFile);
  const data = fs.readFileSync(filePath, "utf-8");
  const { content: result, count } = replaceVersionPlaceholder(data, version);
  if (count === 0) {
    throw new Error(
      `Could not find the '${VERSION_MARKER}' placeholder in ${targetFile}! ` +
        `Every build output is expected to contain at least one: without it ` +
        `the server compares request paths against an unreplaced placeholder ` +
        `and serves the SPA fallback instead of the app bundle.`,
    );
  }
  assertNoPlaceholdersLeft(result, targetFile);
  fs.writeFileSync(filePath, result, "utf-8");
  console.log(`Updated version in ${targetFile} (${count} occurrences)!`);
}

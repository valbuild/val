// We use this to inject the contents of main.jsx into the server
// We want to use Vite / rollup to do this, but ran out of time and patience to do it

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require("fs");
const path = require("path");
const packageJson = require("./package.json");

const files = [
  "dist/valbuild-ui.esm.js",
  "dist/valbuild-ui.cjs.js",
  "server/dist/valbuild-ui-server.esm.js",
  "server/dist/valbuild-ui-server.cjs.js",
];
const version = packageJson.version;

for (const targetFile of files) {
  const filePath = path.join(__dirname, targetFile);
  const replaceString = "$$BUILD_$$REPLACE_WITH_VERSION$$";
  fs.readFile(filePath, "utf-8", (err, data) => {
    if (err) {
      console.error("Error reading file:", err);
      return;
    }

    const result = data.replace(replaceString, version);

    // Write the modified content back to the file
    fs.writeFile(filePath, result, "utf-8", (err) => {
      if (err) {
        console.error("Error writing file:", err);
        return;
      }
      console.log(`Updated version in ${targetFile}!`);
    });
  });
}

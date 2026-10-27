// We use this to inject the contents of main.jsx into the server
// We want to use Vite / rollup to do this, but ran out of time and patience to do it

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");
const packageJson = require("./package.json");
const {
  replaceVersionPlaceholder,
  replaceRecordPlaceholder,
  assertNoPlaceholdersLeft,
  RECORD_MARKER,
} = require("./buildPlaceholders");

const serverFiles = [
  "server/dist/valbuild-ui-server.esm.js",
  "server/dist/valbuild-ui-server.cjs.js",
];
const inputDir = "server/.tmp";
const version = packageJson.version;
function walk(dir) {
  return fs.readdirSync(dir).reduce((files, fileOrDirName) => {
    const fileOrDirPath = path.join(dir, fileOrDirName);
    if (fs.statSync(fileOrDirPath).isDirectory()) {
      return {
        ...files,
        ...walk(fileOrDirPath),
      };
    }
    const { content: fileContent } = replaceVersionPlaceholder(
      fs.readFileSync(fileOrDirPath, "utf-8"),
      version,
    );
    assertNoPlaceholdersLeft(fileContent, fileOrDirPath);
    const encodedContent = Buffer.from(fileContent).toString("base64");
    return {
      ...files,
      [fileOrDirPath.replace(inputDir, "")]: encodedContent,
    };
  }, {});
}

const files = walk(inputDir);
const stringifiedFiles = JSON.stringify(files);

for (const serverFile of serverFiles) {
  const filePath = path.join(__dirname, serverFile);
  const data = fs.readFileSync(filePath, "utf-8");
  const { content: result, count } = replaceRecordPlaceholder(
    data,
    stringifiedFiles,
  );
  if (count === 0) {
    throw new Error(
      `Could not find the '${RECORD_MARKER}' placeholder in ${serverFile}! ` +
        `Without it the Val UI files are not included in the build.`,
    );
  }
  // NOTE: the version placeholder is still expected here - fix-version-hack.js
  // runs next and replaces it.
  assertNoPlaceholdersLeft(result, serverFile, [RECORD_MARKER]);
  fs.writeFileSync(filePath, result, "utf-8");
  console.log(`Replaced script in ${serverFile} with contents of build!`);
}

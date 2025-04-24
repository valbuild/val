// We use this to inject the contents of main.jsx into the server
// We want to use Vite / rollup to do this, but ran out of time and patience to do it

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require("fs");
const path = require("path");
const packageJson = require("./package.json");

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
    const fileContent = fs
      .readFileSync(fileOrDirPath, "utf-8")
      .replaceAll("$$BUILD_$$REPLACE_WITH_VERSION$$", version);
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
  const replaceString = "$$BUILD_$$REPLACE_WITH_RECORD$$";
  fs.readFile(filePath, "utf-8", (err, data) => {
    if (err) {
      console.error("Error reading file:", err);
      return;
    }

    const result = data.replace(replaceString, stringifiedFiles);

    // Write the modified content back to the file
    fs.writeFile(filePath, result, "utf-8", (err) => {
      if (err) {
        console.error("Error writing file:", err);
        return;
      }
      console.log(`Replaced script in ${serverFile} with contents of build!`);
    });
  });
}

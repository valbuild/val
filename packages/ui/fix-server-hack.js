// We use this to inject the contents of main.jsx into the server
// We want to use Vite / rollup to do this, but ran out of time and patience to do it

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require("fs");
const path = require("path");

const serverFile = "server/dist/valbuild-ui-server.esm.js";
const inputFile = "server/.tmp/index.js";
const filePath = path.join(__dirname, serverFile);
const replaceString = "/**REPLACE:SCRIPT*/";
const fileToEncodePath = path.join(__dirname, inputFile);

// Read the contents of the file to be encoded
const fileToEncodeContent = fs.readFileSync(fileToEncodePath, "utf-8");

// Encode the file contents to base64
const encodedContent = Buffer.from(fileToEncodeContent).toString("base64");

// Read the main file and replace the placeholder string
fs.readFile(filePath, "utf-8", (err, data) => {
  if (err) {
    console.error("Error reading file:", err);
    return;
  }

  const result = data.replace(replaceString, encodedContent);

  // Write the modified content back to the file
  fs.writeFile(filePath, result, "utf-8", (err) => {
    if (err) {
      console.error("Error writing file:", err);
      return;
    }
    console.log(
      `Replaced script in ${serverFile} with contents of ${inputFile}!`
    );
  });
});

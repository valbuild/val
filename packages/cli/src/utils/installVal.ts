import { debugPrint, info } from "../logger.js";
import valApiFileContent from "../valApiFileContent.js";
import fs from "fs";
export default function installVal() {
  writeValAPI();
}
//
// write a file to disk at pages/api/val if it doesn't existsSync
function writeValAPI() {
  if (!fs.existsSync("pages/api")) {
    info("No pages/api directory detected. Creating one now.");
    fs.mkdirSync("pages/api");
  }
  if (!fs.existsSync("pages/api/val")) {
    debugPrint("No pages/api/val directory detected. Creating one now.");
    fs.mkdirSync("pages/api/val");
  }
  if (!fs.existsSync("pages/api/val.cli-testing.ts")) {
    fs.writeFileSync("pages/api/val.cli-testing.ts", valApiFileContent);
  } else {
    info("pages/api/val.cli-testing.ts already exists. Skipping.");
  }
}

// TODO
function patchAppRoute() {
  // Find _app.tsx or layout.tsx
  // Add the import statement to the top of the file
  // Wrap the component in a <ValProvider> component
  // ????
  // Profit
}
export function informUserOnHowToPatchAppRoute() {
  info(`
Please add the following import statement to the top of your _app.tsx or layout.tsx file:
    import { ValProvider } from "@valbuild/client";
And wrap your component in a <ValProvider> component:
    <ValProvider>
        <Component {...pageProps} />
    </ValProvider>
`);
}

//TODO
function setEnvironmentVariables() {
  throw new Error("Not implemented");
  // VAL_API_KEY
  // VAL_SECRET
  // VAL_GIT_COMMIT
  // VAL_GIT_BRANCH
  // VAL_BUILD_URL
  // VAL_ORG_NAME
  // VAL_PROJECT_NAME
}

export function informUserOnEnvironmentVariables() {
  info(`
Please set the following environment variables:
    - VAL_API_KEY
    - VAL_SECRET
    - VAL_GIT_COMMIT
    - VAL_GIT_BRANCH
    - VAL_BUILD_URL
    - VAL_ORG_NAME
    - VAL_PROJECT_NAME
`);
}

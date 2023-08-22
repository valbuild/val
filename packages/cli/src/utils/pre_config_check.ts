import fs from "fs";
import { execSync } from "child_process";
import confirm from "@inquirer/confirm";
import { info, printDebuggingHelp } from "../logger.js";
export const isPreConfigCheck = true;

function packageJsonExists() {
  return fs.existsSync("package.json");
}

function hasTsConfig() {
  return fs.existsSync("tsconfig.json");
}

function hasNextJsInPackageJson() {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  return packageJson.dependencies && packageJson.dependencies.next;
}

function hasValConfig() {
  return fs.existsSync("val.config.ts");
}

function hasValAPIDirectory() {
  return fs.existsSync("pages/api/val");
}

function hasAppRoute() {
  return fs.existsSync("pages/_app.js");
}

function hasPagesDir() {
  return fs.existsSync("pages");
}

export async function runChecks() {
  if (!packageJsonExists()) {
    info("No package.json detected");
    const wantsTemplate = await confirm({
      message: "Would you like to use a Val template?",
      default: true,
    });
    if (wantsTemplate) {
      cloneTemplateProjectFromGithub("git@github.com:valbuild/test-repo.git");
      process.exit(0);
    }
    info("Please create a Next.js project first.");
    printDebuggingHelp();
    process.exit(1);
  }
  if (!hasNextJsInPackageJson()) {
    info("It seems you are not using Next.js");
    info("Val currently only supports Next.js");
    printDebuggingHelp();
    process.exit(1);
  }
  if (!hasTsConfig()) {
    info("No tsconfig.json detected");
    info("Val currently only supports TypeScript");
    printDebuggingHelp();
    process.exit(1);
  }
  if (hasValConfig()) {
    info("Val config and the /pages/api/val directory already exists");
    info("Seems like Val is already installed and configured", {
      isGood: true,
    });
    printDebuggingHelp();
    process.exit(1);
  }
}

function cloneTemplateProjectFromGithub(
  url: string,
  projectName = "val-project"
) {
  info("Cloning template project from Github...");
  execSync(`git clone ${url} ${projectName}`); // add try catch
  info("Template project cloned. Have fun!");
  info("run `cd val-project` to enter the project directory.");
  info("run `npm install` to install dependencies.");
  info("run `npm run dev` to start the dev server.");
  info("Visit http://localhost:3000 to see your app.");
}

import chalk from "chalk";
import fs from "fs";
import path from "path";
import simpleGit, { StatusResult } from "simple-git";
import { confirm } from "@inquirer/prompts";
import { transformNextAppRouterValProvider } from "./codemods/transformNextAppRouterValProvider";
import { diffLines } from "diff";
import jcs from "jscodeshift";
import semver from "semver";
import packageJson from "../package.json";
import {
  BASIC_EXAMPLE,
  VAL_API_ROUTER,
  VAL_APP_PAGE,
  VAL_CLIENT,
  VAL_CONFIG,
  VAL_MODULES,
  VAL_RSC,
  VAL_SERVER,
} from "./templates";
import * as logger from "./logger";

const MIN_VAL_VERSION = packageJson.version;
const MIN_NEXT_VERSION = "13.4.0";

let maxResetLength = 0;
export async function init(
  root: string = process.cwd(),
  { yes: defaultAnswers }: { yes?: boolean } = {}
) {
  logger.info(
    "Initializing " +
      chalk.bgBlack.hex("#37cd99")("Val") +
      ' in "' +
      root +
      '"...\n'
  );
  process.stdout.write("Analyzing project...");
  const analysis = await analyze(path.resolve(root), walk(path.resolve(root)));
  // reset cursor:
  process.stdout.write("\x1b[0G");
  logger.info("Analysis:" + " ".repeat(maxResetLength));

  const currentPlan = await plan(analysis, defaultAnswers);
  if (currentPlan.abort) {
    return;
  }

  await execute(currentPlan);
}

const sep = "/";
function walk(dir: string, skip: RegExp = /node_modules|.git/): string[] {
  if (!fs.existsSync(dir)) return [];
  process.stdout.write("\x1b[0G");
  const m =
    "Analyzing project... " +
    (dir.length > 30 ? "..." : "") +
    dir.slice(Math.max(dir.length - 30, 0));
  maxResetLength = Math.max(maxResetLength, m.length);
  process.stdout.write(m + " ".repeat(maxResetLength - m.length));
  return fs.readdirSync(dir).reduce((files, fileOrDirName) => {
    const fileOrDirPath = [dir, fileOrDirName].join("/"); // always use / as path separator since we are doing .endsWith("/foo/bar.ts") when checking for files and we thought this would make it easier (if you are reading this and wondering wtf, then maybe not :) - should work on windows as well?
    if (fs.statSync(fileOrDirPath).isDirectory() && !skip.test(fileOrDirName)) {
      return files.concat(walk(fileOrDirPath));
    }

    return files.concat(fileOrDirPath);
  }, [] as string[]);
}

type Analysis = Partial<{
  root: string;
  srcDir: string;
  packageJsonDir: string;
  valConfigPath: string;
  isTypeScript: boolean;
  isJavaScript: boolean;

  // @valbuild/core package:
  isValCoreInstalled: boolean;
  valCoreVersion: string;
  valCoreVersionIsSatisfied: boolean;

  // @valbuild/next package:
  isValNextInstalled: boolean;
  valNextVersion: string;
  valNextVersionIsSatisfied: boolean;

  // eslint:
  eslintRcJsonPath: string;
  eslintRcJsonText: string;
  eslintRcJsPath: string;
  eslintRcJsText: string;
  valEslintVersion: string;
  isValEslintRulesConfigured: boolean;

  // next:
  nextVersion: string;
  nextVersionIsSatisfied: boolean;
  isNextInstalled: boolean;
  pagesRouter: boolean;
  appRouter: boolean;
  appRouterLayoutFile: string;
  appRouterPath: string;
  appRouterLayoutPath: string;

  // git:
  hasGit: boolean;
  isGitHub: boolean;
  isGitClean: boolean | "packages";
  gitIgnorePath: string;
  gitIgnoreFile?: string;
  gitRemote: {
    owner: string;
    repo: string;
  };

  // TODO:
  // check if modules are used
}>;

const analyze = async (root: string, files: string[]): Promise<Analysis> => {
  if (!fs.existsSync(root)) {
    return {};
  }
  const analysis: Analysis = { root };
  const packageJsonPath = files.find(
    (file) => file === [root, "package.json"].join(sep)
  );
  analysis.packageJsonDir = packageJsonPath && path.dirname(packageJsonPath);

  if (packageJsonPath) {
    const packageJsonText = fs.readFileSync(packageJsonPath, "utf8");
    if (packageJsonText) {
      try {
        const packageJson = JSON.parse(packageJsonText);
        analysis.isValCoreInstalled =
          !!packageJson.dependencies["@valbuild/core"];
        analysis.isValNextInstalled =
          !!packageJson.dependencies["@valbuild/next"];
        analysis.isNextInstalled = !!packageJson.dependencies["next"];
        analysis.valEslintVersion =
          packageJson.devDependencies["@valbuild/eslint-plugin"] ||
          packageJson.dependencies["@valbuild/eslint-plugin"];
        analysis.nextVersion = packageJson.dependencies["next"];
        analysis.valCoreVersion = packageJson.dependencies["@valbuild/core"];
        analysis.valNextVersion = packageJson.dependencies["@valbuild/next"];
      } catch (err) {
        throw new Error(
          `Failed to parse package.json in file: ${packageJsonPath}`
        );
      }
    }
  }
  if (analysis.nextVersion) {
    const minNextVersion = semver.minVersion(analysis.nextVersion)?.version;
    if (minNextVersion) {
      analysis.nextVersionIsSatisfied = semver.satisfies(
        minNextVersion,
        ">=" + MIN_NEXT_VERSION
      );
    }
  }
  if (analysis.valNextVersion) {
    const minValVersion = semver.minVersion(analysis.valNextVersion)?.version;
    if (minValVersion) {
      analysis.valNextVersionIsSatisfied = semver.satisfies(
        minValVersion,
        ">=" + MIN_VAL_VERSION
      );
    }
  }
  if (analysis.valCoreVersion) {
    const minValVersion = semver.minVersion(analysis.valCoreVersion)?.version;
    if (minValVersion) {
      analysis.valCoreVersionIsSatisfied = semver.satisfies(
        minValVersion,
        ">=" + MIN_VAL_VERSION
      );
    }
  }

  analysis.eslintRcJsPath = files.find((file) => file.endsWith(".eslintrc.js"));
  if (analysis.eslintRcJsPath) {
    analysis.eslintRcJsText = fs.readFileSync(analysis.eslintRcJsPath, "utf8");
    if (analysis.eslintRcJsText) {
      // TODO: Evaluate and extract config?
      analysis.isValEslintRulesConfigured = analysis.eslintRcJsText.includes(
        "plugin:@valbuild/recommended"
      );
    }
  }
  analysis.eslintRcJsonPath =
    files.find((file) => file.endsWith(".eslintrc.json")) ||
    files.find((file) => file.endsWith(".eslintrc"));
  if (analysis.eslintRcJsonPath) {
    analysis.eslintRcJsonText = fs.readFileSync(
      analysis.eslintRcJsonPath,
      "utf8"
    );
    if (analysis.eslintRcJsonText) {
      // TODO: Parse properly
      analysis.isValEslintRulesConfigured = analysis.eslintRcJsonText.includes(
        "plugin:@valbuild/recommended"
      );
    }
  }

  const pagesRouterAppPath =
    files.find((file) => file.endsWith("/pages/_app.tsx")) ||
    files.find((file) => file.endsWith("/pages/_app.jsx"));
  analysis.pagesRouter = !!pagesRouterAppPath;
  if (pagesRouterAppPath) {
    analysis.isTypeScript = !!pagesRouterAppPath.endsWith(".tsx");
    analysis.isJavaScript = !!pagesRouterAppPath.endsWith(".jsx");
    analysis.srcDir = path.dirname(path.dirname(pagesRouterAppPath));
  }

  const appRouterLayoutPath =
    files.find((file) => file.endsWith("/app/layout.tsx")) ||
    files.find((file) => file.endsWith("/app/layout.jsx"));

  if (appRouterLayoutPath) {
    analysis.appRouter = true;
    analysis.appRouterLayoutPath = appRouterLayoutPath;
    analysis.appRouterLayoutFile = fs.readFileSync(appRouterLayoutPath, "utf8");
    analysis.isTypeScript = !!appRouterLayoutPath.endsWith(".tsx");
    analysis.isJavaScript = !!appRouterLayoutPath.endsWith(".jsx");
    analysis.appRouterPath = path.dirname(appRouterLayoutPath);
    analysis.srcDir = path.dirname(analysis.appRouterPath);
  }

  try {
    const git = simpleGit(root);
    const gitStatus = await git.status([]);
    const gitRemoteOrigin = await git.remote(["-v"]);
    analysis.hasGit = true;
    analysis.isGitHub = gitRemoteOrigin
      ? !!gitRemoteOrigin.includes("github.com")
      : false;
    analysis.isGitClean = getGitStatusIsClean(gitStatus);
    // get owner and repo from git remote:
    if (gitRemoteOrigin) {
      // Split the URL by colon
      const parts = gitRemoteOrigin.split(":");

      // Extract owner and repo
      const owner = parts[0].split("@")[1];
      const repo = parts[1].replace(".git", ""); // Remove .git extension if present

      analysis.gitRemote = {
        owner,
        repo,
      };
    }
  } catch (err) {
    // console.error(err);
  }
  const gitIgnorePath = path.join(root, ".gitignore");
  analysis.gitIgnorePath = gitIgnorePath;
  analysis.gitIgnoreFile = fs.readFileSync(gitIgnorePath, "utf-8");
  return analysis;
};

type FileOp = {
  path: string;
  source: string;
};
type Plan = Partial<{
  root: string;
  createValServer: FileOp;
  createValRouter: FileOp;
  createValAppPage: FileOp;
  createConfigFile: FileOp;
  createValRsc: false | FileOp;
  createValClient: false | FileOp;
  updateAppLayout: false | FileOp;
  updateEslint: false | FileOp; // TODO: do this
  useTypescript: boolean;
  useJavascript: boolean;
  abort: boolean;
  ignoreGitDirty: boolean;
  updateGitIgnore: false | FileOp;
  gitRemote:
    | false
    | {
        owner: string;
        repo: string;
      };
  includeExample: false | FileOp;
  includeModules: false | FileOp;
  updateVSCodeSettings: false | FileOp;
}>;

async function plan(
  analysis: Readonly<Analysis>,
  defaultAnswers: boolean = false
): Promise<Plan> {
  const plan: Plan = { root: analysis.root };

  if (analysis.root) {
    logger.info("  Root: " + analysis.root, { isGood: true });
  } else {
    logger.error("Failed to find root directory");
    return { abort: true };
  }
  if (
    !analysis.srcDir ||
    !fs.statSync(analysis.srcDir).isDirectory() ||
    !analysis.isNextInstalled
  ) {
    logger.error("Val requires a Next.js project");
    return { abort: true };
  }
  if (analysis.srcDir) {
    logger.info("  Source dir: " + analysis.srcDir, { isGood: true });
  } else {
    logger.error("Failed to determine source directory");
    return { abort: true };
  }
  if (!analysis.isNextInstalled) {
    logger.error("Val requires a Next.js project");
    return { abort: true };
  }
  if (!analysis.isValCoreInstalled) {
    logger.error("Install @valbuild/core first");
    return { abort: true };
  } else {
    if (!analysis.valCoreVersionIsSatisfied) {
      logger.warn(
        `  This init script expects @valbuild/core >= ${MIN_VAL_VERSION}. Found: ${analysis.valCoreVersion}`
      );
      const answer = !defaultAnswers
        ? await confirm({
            message: "Continue?",
            default: false,
          })
        : false;
      if (!answer) {
        logger.error(
          `Aborted: @valbuild/core version is not satisfied.\n\nInstall the @valbuild/core@${MIN_VAL_VERSION} package with your favorite package manager.\n\nExample:\n\n  npm install -D @valbuild/core@${MIN_VAL_VERSION}\n`
        );
        return { abort: true };
      }
    } else {
      logger.info(
        `  Val version: found ${analysis.valCoreVersion} >= ${MIN_VAL_VERSION}`,
        { isGood: true }
      );
    }
  }
  if (!analysis.isValNextInstalled) {
    logger.error("Install @valbuild/next first");
    return { abort: true };
  } else {
    if (!analysis.valNextVersionIsSatisfied) {
      logger.warn(
        `  This init script expects @valbuild/next >= ${MIN_VAL_VERSION}. Found: ${analysis.valNextVersion}`
      );
      const answer = !defaultAnswers
        ? await confirm({
            message: "Continue?",
            default: false,
          })
        : false;
      if (!answer) {
        logger.error(
          `Aborted: @valbuild/next version is not satisfied.\n\nInstall the @valbuild/next@${MIN_VAL_VERSION} package with your favorite package manager.\n\nExample:\n\n  npm install -D @valbuild/next@${MIN_VAL_VERSION}\n`
        );
        return { abort: true };
      }
    } else {
      logger.info(
        `  Val version: found ${analysis.valNextVersion} >= ${MIN_VAL_VERSION}`,
        { isGood: true }
      );
    }
  }
  if (!analysis.nextVersionIsSatisfied) {
    logger.error(
      `Val requires Next.js >= ${MIN_NEXT_VERSION}. Found: ${analysis.nextVersion}`
    );
    return { abort: true };
  } else {
    logger.info(
      `  Next.js version: found ${analysis.nextVersion} >= ${MIN_NEXT_VERSION}`,
      { isGood: true }
    );
  }
  if (analysis.isTypeScript) {
    logger.info("  Use: TypeScript", { isGood: true });
    plan.useTypescript = true;
  }
  if (analysis.isJavaScript) {
    logger.info("  Use: JavaScript", { isGood: true });
    if (!plan.useTypescript) {
      plan.useJavascript = true;
    }
  }
  if (analysis.isTypeScript) {
    const tsconfigJsonPath = path.join(analysis.root, "tsconfig.json");
    if (fs.statSync(tsconfigJsonPath).isFile()) {
      logger.info("  tsconfig.json: found", { isGood: true });
    } else {
      logger.error("tsconfig.json: Failed to find tsconfig.json");
      return { abort: true };
    }
  } else {
    const jsconfigJsonPath = path.join(analysis.root, "jsconfig.json");
    if (fs.statSync(jsconfigJsonPath).isFile()) {
      logger.info("  jsconfig.json: found", { isGood: true });
    } else {
      logger.error(" jsconfig.json: failed to find jsconfig.json");
      return { abort: true };
    }
  }

  if (analysis.valEslintVersion === undefined) {
    const answer = !defaultAnswers
      ? await confirm({
          message:
            "The recommended Val eslint plugin (@valbuild/eslint-plugin) is not installed. Continue?",
          default: false,
        })
      : false;
    if (!answer) {
      logger.error(
        "Aborted: the Val eslint plugin is not installed.\n\nInstall the @valbuild/eslint-plugin package with your favorite package manager.\n\nExample:\n\n  npm install -D @valbuild/eslint-plugin\n"
      );
      return { abort: true };
    }
  } else {
    logger.info("  @valbuild/eslint-plugin: installed", { isGood: true });
  }
  if (analysis.appRouter) {
    logger.info("  Use: App Router", { isGood: true });
  }
  if (analysis.pagesRouter) {
    logger.info("  Use: Pages Router", { isGood: true });
  }
  if (analysis.isGitClean) {
    if (analysis.isGitClean === "packages") {
      logger.info(
        "  Git state: clean (only package.json / lock files modified)",
        {
          isGood: true,
        }
      );
    } else {
      logger.info("  Git state: clean", { isGood: true });
    }
  }
  if (!analysis.isGitClean) {
    logger.warn("  Git state: dirty");
  }

  if (!analysis.isGitClean) {
    while (plan.ignoreGitDirty === undefined) {
      const answer = !defaultAnswers
        ? await confirm({
            message: "You have uncommitted changes. Continue?",
            default: false,
          })
        : false;
      plan.ignoreGitDirty = answer;
      if (!answer) {
        logger.error("Aborted: git state dirty");
        return { abort: true };
      }
    }
  }

  // New required files:
  const valConfigPath = path.join(
    analysis.root,
    analysis.isTypeScript ? "val.config.ts" : "val.config.js"
  );
  if (fs.existsSync(valConfigPath)) {
    logger.error(
      `Aborted: a Val config file: ${valConfigPath} already exists.`
    );
    return { abort: true };
  }

  plan.createConfigFile = {
    path: valConfigPath,
    source: VAL_CONFIG(!!analysis.isTypeScript, {}),
  };

  {
    const answer = !defaultAnswers
      ? await confirm({
          message: "Include example Val files?",
          default: true,
        })
      : true;
    if (answer) {
      const exampleDir = path.join(analysis.srcDir, "examples", "val");
      const examplePath = path.join(
        exampleDir,
        "example.val." + (analysis.isJavaScript ? "js" : "ts")
      );
      const exampleImport = path
        .relative(exampleDir, valConfigPath)
        .replace(".js", "")
        .replace(".ts", "");
      if (!analysis.packageJsonDir) {
        throw Error(
          "Could not detect package.json directory! This is a Val bug."
        );
      }
      const exampleModuleFilePath = `/${path.relative(
        analysis.packageJsonDir,
        examplePath
      )}`;

      plan.includeExample = {
        path: examplePath,
        source: BASIC_EXAMPLE(
          exampleModuleFilePath,
          exampleImport,
          !!analysis.isJavaScript
        ),
      };
    }
  }

  const valModulesDir = analysis.root;
  const valModulesImport = path
    .relative(valModulesDir, valConfigPath)
    .replace(".js", "")
    .replace(".ts", "");
  const exampleModuleFilePath = plan.includeExample
    ? plan.includeExample.path
    : undefined;
  const exampleModuleImport =
    exampleModuleFilePath &&
    path
      .relative(valModulesDir, exampleModuleFilePath)
      .replace(".js", "")
      .replace(".ts", "");
  plan.includeModules = {
    path: path.join(valModulesDir, "val.modules.ts"),
    source: VAL_MODULES(valModulesImport, exampleModuleImport),
  };
  const valUtilsDir = path.join(analysis.srcDir, "val");
  const valModulesServerImport = path
    .relative(valUtilsDir, plan.includeModules.path)
    .replace(".js", "")
    .replace(".ts", "");
  const valUtilsImportPath = path
    .relative(valUtilsDir, valConfigPath)
    .replace(".js", "")
    .replace(".ts", "");
  const valServerPath = path.join(
    valUtilsDir,
    analysis.isTypeScript ? "val.server.ts" : "val.server.js"
  );
  plan.createValServer = {
    path: valServerPath,
    source: VAL_SERVER(valUtilsImportPath, valModulesServerImport),
  };

  if (!analysis.appRouterPath) {
    logger.warn('Creating a new "app" router');
  }

  const valAppPagePath = path.join(
    analysis.appRouterPath || path.join(analysis.srcDir, "app"),
    "(val)",
    "val",
    "[[...val]]",
    analysis.isTypeScript ? "page.tsx" : "page.jsx"
  );
  const valPageImportPath = path
    .relative(path.dirname(valAppPagePath), valConfigPath)
    .replace(".js", "")
    .replace(".ts", "");
  plan.createValAppPage = {
    path: valAppPagePath,
    source: VAL_APP_PAGE(valPageImportPath),
  };

  const valRouterPath = path.join(
    analysis.appRouterPath || path.join(analysis.srcDir, "app"),
    "(val)",
    "api",
    "val",
    "[[...val]]",
    analysis.isTypeScript ? "route.ts" : "route.js"
  );
  const valRouterImportPath = path
    .relative(path.dirname(valRouterPath), valServerPath)
    .replace(".js", "")
    .replace(".ts", "");
  plan.createValRouter = {
    path: valRouterPath,
    source: VAL_API_ROUTER(valRouterImportPath),
  };

  // Util files:

  while (plan.createValClient === undefined) {
    const answer = !defaultAnswers
      ? await confirm({
          message: "Setup useVal for Client Components",
          default: true,
        })
      : true;
    if (answer) {
      plan.createValClient = {
        path: path.join(
          valUtilsDir,
          analysis.isTypeScript ? "val.client.ts" : "val.client.js"
        ),
        source: VAL_CLIENT(valUtilsImportPath),
      };
    } else {
      plan.createValClient = false;
    }
  }
  while (plan.createValRsc === undefined) {
    const answer = !defaultAnswers
      ? await confirm({
          message: "Setup fetchVal for React Server Components",
          default: true,
        })
      : true;
    if (answer) {
      plan.createValRsc = {
        path: path.join(
          valUtilsDir,
          analysis.isTypeScript ? "val.rsc.ts" : "val.rsc.js"
        ),
        source: VAL_RSC(valUtilsImportPath),
      };
    } else {
      plan.createValRsc = false;
    }
  }

  // Patches:

  const NO_PATCH_WARNING =
    "Remember to add the ValProvider in your root app/layout.tsx or pages/_app.tsx file.\n";
  if (analysis.appRouterLayoutPath) {
    if (!analysis.appRouterLayoutFile) {
      logger.error("Failed to read app router layout file");
      return { abort: true };
    }

    const res = transformNextAppRouterValProvider(
      {
        path: analysis.appRouterLayoutPath,
        source: analysis.appRouterLayoutFile,
      },
      {
        j: jcs,
        jscodeshift: jcs.withParser("tsx"),
        stats: () => {},
        report: () => {},
      },
      {
        configImportPath: path
          .relative(path.dirname(analysis.appRouterLayoutPath), valConfigPath)
          .replace(".js", "")
          .replace(".ts", ""),
      }
    );

    const diff = diffLines(analysis.appRouterLayoutFile, res, {});

    let s = "";
    diff.forEach((part) => {
      if (part.added) {
        s += chalk.green(part.value);
      } else if (part.removed) {
        s += chalk.red(part.value);
      } else {
        s += part.value;
      }
    });
    const answer = !defaultAnswers
      ? await confirm({
          message: `Automatically patch ${analysis.appRouterLayoutPath} file?`,
          default: true,
        })
      : true;
    if (answer) {
      const answer = !defaultAnswers
        ? await confirm({
            message: `Do you accept the following patch:\n${s}\n`,
            default: true,
          })
        : true;
      if (!answer) {
        logger.warn(NO_PATCH_WARNING);
        plan.updateAppLayout = false;
      } else {
        plan.updateAppLayout = {
          path: analysis.appRouterLayoutPath,
          source: res,
        };
      }
    } else {
      logger.warn(NO_PATCH_WARNING);
    }
  }
  if (analysis.pagesRouter) {
    logger.warn(NO_PATCH_WARNING);
  }

  if (analysis.valEslintVersion) {
    if (analysis.isValEslintRulesConfigured) {
      logger.warn("  @valbuild/eslint-plugin rules: already configured");
    } else {
      if (analysis.eslintRcJsPath) {
        logger.warn(
          'Cannot patch eslint: found .eslintrc.js but can only patch JSON files (at the moment).\nAdd the following to your eslint config:\n\n  "extends": ["plugin:@valbuild/recommended"]\n'
        );
      } else if (analysis.eslintRcJsonPath) {
        const answer = !defaultAnswers
          ? await confirm({
              message:
                "Patch eslintrc.json to use the recommended Val eslint rules?",
              default: true,
            })
          : true;
        if (answer) {
          const currentEslintRc = fs.readFileSync(
            analysis.eslintRcJsonPath,
            "utf-8"
          );
          const parsedEslint = JSON.parse(currentEslintRc);
          if (typeof parsedEslint !== "object") {
            logger.error(
              `Could not patch eslint: ${analysis.eslintRcJsonPath} was not an object`
            );
            return { abort: true };
          }
          if (typeof parsedEslint.extends === "string") {
            parsedEslint.extends = [parsedEslint.extends];
          }
          parsedEslint.extends = parsedEslint.extends || [];
          parsedEslint.extends.push("plugin:@valbuild/recommended");
          plan.updateEslint = {
            path: analysis.eslintRcJsonPath,
            source: JSON.stringify(parsedEslint, null, 2) + "\n",
          };
        }
      } else {
        logger.warn("Cannot patch eslint: failed to find eslint config file");
      }
    }
  }

  {
    if (analysis.gitIgnorePath) {
      const answer = !defaultAnswers
        ? await confirm({
            message: "Append .gitignore entry for Val cache? (recommended)",
            default: true,
          })
        : true;
      if (answer) {
        plan.updateGitIgnore = {
          path: analysis.gitIgnorePath,
          source:
            (analysis.gitIgnoreFile ? `${analysis.gitIgnoreFile}\n\n` : "") +
            "# Val local cache\n.val\n",
        };
      } else {
        plan.updateGitIgnore = false;
      }
    } else {
      plan.updateGitIgnore = false;
    }
  }
  {
    const answer = !defaultAnswers
      ? await confirm({
          message: "Add the Val Build IntelliSense to .vscode/extensions.json?",
          default: true,
        })
      : true;
    if (answer) {
      const vscodeDir = path.join(analysis.root, ".vscode");
      const settingsPath = path.join(vscodeDir, "extensions.json");
      let currentSettings = {};

      try {
        const currentSettingsFile = fs.readFileSync(settingsPath, "utf-8");
        if (currentSettingsFile) {
          try {
            currentSettings = JSON.parse(currentSettingsFile);
          } catch (err) {
            logger.warn(
              `Failed to parse VS Code extensions.json found here: ${settingsPath}.${
                err instanceof Error ? `Parse error: ${err.message}` : ""
              }`
            );
            return {
              abort: true,
            };
          }
        }
      } catch {
        // ignore - dir does not exist (most likely)
      }
      const currentRecommendations: string[] | undefined =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (currentSettings as any).recommendations;
      const valBuildIntelliSense = "valbuild.vscode-val-build";
      if (!currentRecommendations?.includes(valBuildIntelliSense)) {
        currentSettings = {
          ...currentSettings,
          recommendations: (currentRecommendations || []).concat(
            valBuildIntelliSense
          ),
        };
      }
      plan.updateVSCodeSettings = {
        path: settingsPath,
        source: JSON.stringify(currentSettings, null, 2),
      };
    } else {
      plan.updateVSCodeSettings = false;
    }
  }

  return plan;
}

async function execute(plan: Plan) {
  if (plan.abort) {
    return logger.warn("Aborted");
  }
  if (!plan.root) {
    return logger.error("Failed to find root directory");
  }
  logger.info("Executing...");
  for (const [key, maybeFileOp] of Object.entries(plan)) {
    if (isFileOp(maybeFileOp)) {
      writeFile(maybeFileOp, plan.root, key.startsWith("update"));
    }
  }
  logger.info(`
  
Val was successfully initialized!

  Start the application:

  $ ${chalk.cyan("npm run dev")}

  Open (assumes http://localhost:3000):

  ${chalk.bgBlack.hex("#37cd99").underline(`http://localhost:3000/val`)}

  When you want to enable editor support, import the project by opening the following link:
  
  ${chalk.bgBlack
    .hex("#37cd99")
    .underline(
      `https://app.val.build/orgs/new${
        plan.gitRemote
          ? `?org=${encodeURIComponent(
              plan.gitRemote.owner
            )}&owner=${encodeURIComponent(
              plan.gitRemote.owner
            )}&repo=${encodeURIComponent(plan.gitRemote.repo)}`
          : ""
      }`
    )}

`);
}

function writeFile(
  fileOp: FileOp | undefined,
  rootDir: string,
  isUpdate: boolean
) {
  if (fileOp) {
    fs.mkdirSync(path.dirname(fileOp.path), { recursive: true });
    fs.writeFileSync(fileOp.path, fileOp.source);
    logger.info(
      `  ${isUpdate ? "Patched" : "Created"} file: ${fileOp.path.replace(
        rootDir,
        ""
      )}`,
      { isGood: true }
    );
  }
}
function getGitStatusIsClean(gitStatus: StatusResult): Analysis["isGitClean"] {
  const filteredFiles = gitStatus.files.filter(
    ({ path }) =>
      !(
        // ignore updates to package.json and lock files
        // since user might have just installed val
        // TODO: check if package.json only includes val related things
        (
          path === "package.json" ||
          // lock files:
          path === "package-lock.json" ||
          path === "yarn.lock" ||
          path === "pnpm-lock.yaml"
        )
      )
  );
  if (filteredFiles.length === 0) {
    if (gitStatus.files.length !== 0) {
      return "packages";
    }
    return true;
  }
  return false;
}

function isFileOp(maybeFileOp: unknown): maybeFileOp is FileOp {
  return (
    typeof maybeFileOp !== "boolean" &&
    typeof maybeFileOp !== "string" &&
    typeof maybeFileOp === "object" &&
    !!maybeFileOp &&
    "path" in maybeFileOp &&
    "source" in maybeFileOp &&
    typeof maybeFileOp.path === "string" &&
    typeof maybeFileOp.source === "string"
  );
}

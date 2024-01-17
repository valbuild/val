import chalk from "chalk";
import fs from "fs";
import path from "path";
import simpleGit from "simple-git";
import { confirm } from "@inquirer/prompts";
import { transformNextAppRouterValProvider } from "./codemods/app/transformNextAppRouterValProvider";
import { diffLines } from "diff";
import jcs from "jscodeshift";
import semver from "semver";
import packageJson from "../package.json";
import {
  VAL_API_ROUTER,
  VAL_APP_PAGE,
  VAL_CLIENT,
  VAL_CONFIG,
  VAL_SERVER,
} from "./templates";

const MIN_VAL_VERSION = packageJson.version;
const MIN_NEXT_VERSION = "13.4.0";
export async function init(
  root: string = process.cwd(),
  defaultAnswers = false
) {
  console.log('Initializing Val in "' + root + '"...');
  console.log();
  process.stdout.write("Analyzing project...");
  const analysis = await analyze(root, walk(root));
  // reset cursor:
  process.stdout.write("\x1b[0G");
  console.log("Analysis:" + " ".repeat(20));

  const currentPlan = await plan(analysis, defaultAnswers);
  if (currentPlan.abort) {
    return;
  }

  await execute(currentPlan);
}

const sep = "/";
function walk(dir: string, skip: RegExp = /node_modules|.git/): string[] {
  return fs.readdirSync(dir).reduce((files, fileOrDirName) => {
    const fileOrDirPath = [dir, fileOrDirName].join("/"); // always use / as path separator - should work on windows as well?
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
  isTypescript: boolean;
  isJavascript: boolean;

  // Val package:
  isValInstalled: boolean;
  valVersion: string;
  valVersionIsSatisfied: boolean;

  // eslint:
  eslintRcJsonPath: string;
  eslintRcJsonText: string;
  eslintRcJsPath: string;
  eslintRcJsText: string;
  isValEslintInstalled: boolean;
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
  isGitClean: boolean;

  // TODO:
  // check if modules are used
}>;

const analyze = async (root: string, files: string[]): Promise<Analysis> => {
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
        analysis.isValInstalled = !!packageJson.dependencies["@valbuild/next"];
        analysis.isNextInstalled = !!packageJson.dependencies["next"];
        analysis.isValEslintInstalled =
          !!packageJson.devDependencies["@valbuild/eslint"] ||
          !!packageJson.dependencies["@valbuild/eslint"];
        analysis.nextVersion = packageJson.dependencies["next"];
        analysis.valVersion = packageJson.dependencies["@valbuild/next"];
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
  if (analysis.valVersion) {
    const minValVersion = semver.minVersion(analysis.valVersion)?.version;
    if (minValVersion) {
      analysis.valVersionIsSatisfied = semver.satisfies(
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
    analysis.isTypescript = !!pagesRouterAppPath.endsWith(".tsx");
    analysis.isJavascript = !!pagesRouterAppPath.endsWith(".jsx");
    analysis.srcDir = path.dirname(path.dirname(pagesRouterAppPath));
  }

  const appRouterLayoutPath =
    files.find((file) => file.endsWith("/app/layout.tsx")) ||
    files.find((file) => file.endsWith("/app/layout.jsx"));

  if (appRouterLayoutPath) {
    analysis.appRouter = true;
    analysis.appRouterLayoutPath = appRouterLayoutPath;
    analysis.appRouterLayoutFile = fs.readFileSync(appRouterLayoutPath, "utf8");
    analysis.isTypescript = !!appRouterLayoutPath.endsWith(".tsx");
    analysis.isJavascript = !!appRouterLayoutPath.endsWith(".jsx");
    analysis.appRouterPath = path.dirname(appRouterLayoutPath);
    analysis.srcDir = path.dirname(analysis.appRouterPath);
  }

  try {
    const git = simpleGit(root);
    const gitStatus = await git.status();
    const gitRemoteOrigin = await git.remote(["-v"]);
    analysis.hasGit = true;
    analysis.isGitHub = gitRemoteOrigin
      ? !!gitRemoteOrigin.includes("github.com")
      : false;
    analysis.isGitClean = gitStatus.isClean();
  } catch (err) {
    console.error(err);
  }
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
}>;

function warn(msg: string) {
  console.log(chalk.bgYellow("WARNING") + ` ${msg}`);
}

function error(msg: string) {
  console.log(chalk.red("ERROR") + ` ${msg}`);
}

async function plan(
  analysis: Readonly<Analysis>,
  defaultAnswers: boolean = false
): Promise<Plan> {
  const plan: Plan = { root: analysis.root };

  if (analysis.root) {
    console.log(chalk.green("  Root: " + analysis.root));
  } else {
    error("Failed to find root directory");
    return { abort: true };
  }
  if (analysis.srcDir) {
    console.log(chalk.green("  Source dir: " + analysis.root));
  } else {
    error("Failed to determine source directory");
    return { abort: true };
  }
  if (!analysis.isValInstalled) {
    error("Install @valbuild/next first");
    return { abort: true };
  } else {
    console.log(chalk.green(`  Val version >= ${MIN_VAL_VERSION}`));
  }
  if (!analysis.isNextInstalled) {
    error("Val requires a Next.js project");
    return { abort: true };
  }
  if (!analysis.nextVersionIsSatisfied) {
    error(
      `Val requires Next.js >= ${MIN_NEXT_VERSION}. Found: ${analysis.nextVersion}`
    );
    return { abort: true };
  } else {
    console.log(chalk.green(`  Next.js version >= ${MIN_NEXT_VERSION}`));
  }
  if (analysis.isTypescript) {
    const tsconfigJsonPath = path.join(analysis.root, "tsconfig.json");
    if (fs.statSync(tsconfigJsonPath).isFile()) {
      console.log(chalk.green("  tsconfig.json found"));
    } else {
      error("Failed to find tsconfig.json");
      return { abort: true };
    }
  } else {
    const jsconfigJsonPath = path.join(analysis.root, "jsconfig.json");
    if (fs.statSync(jsconfigJsonPath).isFile()) {
      console.log(chalk.green("  jsconfig.json found"));
    } else {
      error("Failed to find jsconfig.json");
      return { abort: true };
    }
  }

  if (analysis.isValEslintInstalled) {
    console.log(chalk.green("  @valbuild/eslint installed"));
  }
  if (analysis.isValEslintRulesConfigured) {
    console.log(chalk.green("  @valbuild/eslint rules configured"));
  }
  if (analysis.isTypescript) {
    console.log(chalk.green("  Uses TypeScript"));
    plan.useTypescript = true;
  }
  if (analysis.isJavascript) {
    console.log(chalk.green("  Uses JavaScript"));
    if (!plan.useTypescript) {
      plan.useJavascript = true;
    }
  }
  if (analysis.appRouter) {
    console.log(chalk.green("  Uses App Router"));
  }
  if (analysis.pagesRouter) {
    console.log(chalk.green("  Uses Pages Router"));
  }
  if (analysis.isGitClean) {
    console.log(chalk.green("  Git state: clean"));
  }
  if (!analysis.isGitClean) {
    console.log(chalk.red("  Git state: dirty"));
  }
  console.log();
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
        error("Aborting: git state dirty");
        return { abort: true, ignoreGitDirty: true };
      }
    }
  }

  // New required files:
  const valConfigPath = path.join(analysis.root, "val.config.ts");

  plan.createConfigFile = {
    path: valConfigPath,
    source: VAL_CONFIG({}),
  };

  const valUtilsDir = path.join(analysis.srcDir, "val");
  const valUtilsImportPath = path
    .relative(valUtilsDir, valConfigPath)
    .replace(".js", "")
    .replace(".ts", "");

  const valServerPath = path.join(
    valUtilsDir,
    analysis.isTypescript ? "val.server.ts" : "val.server.js"
  );
  plan.createValServer = {
    path: valServerPath,
    source: VAL_SERVER(valUtilsImportPath),
  };

  if (!analysis.appRouterPath) {
    warn('Creating a new "app" router');
  }

  const valAppPagePath = path.join(
    analysis.appRouterPath || path.join(analysis.srcDir, "app"),
    "(val)",
    "val",
    analysis.isTypescript ? "page.tsx" : "page.jsx"
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
    analysis.isTypescript ? "router.tsx" : "router.jsx"
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
          analysis.isTypescript ? "val.client.ts" : "val.client.js"
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
          analysis.isTypescript ? "val.rsc.ts" : "val.rsc.js"
        ),
        source: VAL_SERVER(valUtilsImportPath),
      };
    } else {
      plan.createValRsc = false;
    }
  }

  if (analysis.eslintRcJsPath) {
    warn("ESLint config found: " + analysis.eslintRcJsPath);
    warn("Remember to add ");
  }

  // Patches:

  const NO_PATCH_WARNING =
    "Remember to manually patch your pages/_app.tsx file to use Val Provider. See docs for details";
  if (analysis.appRouterLayoutPath) {
    if (!analysis.appRouterLayoutFile) {
      error("Failed to read app router layout file");
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
        warn(NO_PATCH_WARNING);
        plan.updateAppLayout = false;
      } else {
        plan.updateAppLayout = {
          path: analysis.appRouterLayoutPath,
          source: res,
        };
      }
    } else {
      warn(NO_PATCH_WARNING);
    }
  }
  if (analysis.pagesRouter) {
    warn(NO_PATCH_WARNING);
  }

  return plan;
}

async function execute(plan: Plan) {
  if (plan.abort) {
    return warn("Aborted");
  }
  if (!plan.root) {
    return error("Failed to find root directory");
  }
  console.log("Executing...");
  for (const [key, fileOp] of Object.entries(plan)) {
    writeFile(fileOp, plan.root, key.startsWith("update"));
  }
}

function writeFile(
  fileOp: string | FileOp | undefined | boolean,
  rootDir: string,
  isUpdate: boolean
) {
  if (fileOp && typeof fileOp !== "boolean" && typeof fileOp !== "string") {
    fs.mkdirSync(path.dirname(fileOp.path), { recursive: true });
    fs.writeFileSync(fileOp.path, fileOp.source);
    console.log(
      `  ${chalk.green(
        `${isUpdate ? "Updated" : "Created"} file: `
      )}${fileOp.path.replace(rootDir, "")}`
    );
  }
}

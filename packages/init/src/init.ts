import chalk from "chalk";
import fs from "fs";
import path from "path";
import simpleGit from "simple-git";
import { confirm } from "@inquirer/prompts";
import { transformNextAppRouterValProvider } from "./codemods/app/transformNextAppRouterValProvider";
import { diffLines } from "diff";
import jcs from "jscodeshift";

export async function init(root: string = process.cwd()) {
  console.log('Initializing Val in "' + root + '"...');
  process.stdout.write("Analyzing project...");
  const analysis = await analyze(root, walk(root));
  // reset cursor:
  process.stdout.write("\x1b[0G");
  console.log("Analysis:" + " ".repeat(20));

  promptUser(analysis);
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
  isValInstalled: boolean;
  isTypescript: boolean;
  isJavascript: boolean;

  // eslint:
  eslintRcJsonPath: string;
  eslintRcJsonText: string;
  eslintRcJsPath: string;
  eslintRcJsText: string;
  isValEslintInstalled: boolean;
  isValEslintRulesConfigured: boolean;

  // next:
  isNextInstalled: boolean;
  pagesRouter: boolean;
  appRouter: boolean;
  appRouterLayoutFile: string;
  appRouterLayoutPath: string;

  // git:
  hasGit: boolean;
  isGitHub: boolean;
  isGitClean: boolean;
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
      } catch (err) {
        throw new Error(
          `Failed to parse package.json in file: ${packageJsonPath}`
        );
      }
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
    analysis.srcDir = path.dirname(path.dirname(appRouterLayoutPath));
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

type Result<T> =
  | { ok: true; value: T; warnings?: string }
  | { ok: false; error: string };

type Transforms = Partial<{
  cancel: boolean;
  useRsc: boolean;
  useClient: boolean;
  updateEslint: boolean;
  ignoreGitDirty: boolean;
  confirmedAppLayoutText: string;
}> &
  Analysis;

function warn(msg: string) {
  console.log(chalk.bgYellow("WARNING") + ` ${msg}`);
}

function error(msg: string) {
  console.log(chalk.red("ERROR") + ` ${msg}`);
}

async function promptUser(analysis: Readonly<Analysis>) {
  const transforms: Transforms = { ...analysis };
  if (!analysis.isValInstalled) {
    error("Install @valbuild/next first");
    return { cancel: true };
  } else {
    console.log(chalk.green("  @valbuild/next installed"));
  }
  if (!analysis.isNextInstalled) {
    error("Val requires a Next.js project");
    return { cancel: true };
  } else {
    console.log(chalk.green("  Is NextJS Project"));
  }

  if (analysis.isValEslintInstalled) {
    console.log(chalk.green("  @valbuild/eslint installed"));
  }
  if (analysis.isValEslintRulesConfigured) {
    console.log(chalk.green("  @valbuild/eslint rules configured"));
  }
  if (analysis.isTypescript) {
    console.log(chalk.green("  Use Val with TypeScript"));
  }
  if (analysis.isJavascript) {
    console.log(chalk.green("  Use Val with JavaScript"));
  }

  console.log();
  while (transforms.useClient === undefined) {
    const answer = await confirm({
      message: "Install useVal for Client Components",
      default: true,
    });
    transforms.useClient = answer;
  }
  while (transforms.useRsc === undefined) {
    const answer = await confirm({
      message: "Install fetchVal for React Server Components",
      default: true,
    });
    transforms.useRsc = answer;
  }

  if (analysis.appRouterLayoutPath) {
    if (!analysis.appRouterLayoutFile) {
      error("Failed to read app router layout file");
      return { cancel: true };
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
        configImportPath: "../val.config", // TODO: fix this
      }
    );

    const diff = diffLines(analysis.appRouterLayoutFile, res, {});

    let s = "";
    diff.forEach((part, i) => {
      if (part.added) {
        s += chalk.green(part.value);
      } else if (part.removed) {
        s += chalk.red(part.value);
      } else {
        s += part.value;
      }
    });
    const answer = await confirm({
      message: `Patch Val Provider to ${analysis.appRouterLayoutPath} file?\n\n${s}`,
      default: true,
    });
    if (answer) {
      transforms.confirmedAppLayoutText = res;
    } else {
      warn(
        "Val Provider not patched. You will need to do this manually to get the visual editing experience in Val."
      );
    }
  }
  if (analysis.pagesRouter) {
    warn(
      "Remember to manually patch your pages/_app.tsx file to use Val Provider. See docs for details."
    );
  }

  if (!analysis.isGitClean) {
    while (transforms.ignoreGitDirty === undefined) {
      const answer = await confirm({
        message: "You have uncommitted changes. Continue?",
        default: false,
      });
      transforms.ignoreGitDirty = answer;
    }
  }
}

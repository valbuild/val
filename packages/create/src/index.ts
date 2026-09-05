import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import degit from "degit";
import { confirm, input } from "@inquirer/prompts";
import chalk from "chalk";
import { applyFeatures, type Features } from "./features";
import { parseFeatureFlags, reconcile } from "./featureFlags";
import {
  foreignLockFiles,
  PACKAGE_MANAGER_COMMANDS,
  PACKAGE_MANAGERS,
  PackageManager,
  resolvePackageManager,
} from "./packageManager";

const PKG = {
  name: "@valbuild/create",
  version: "0.1.0",
};

interface Template {
  name: string;
  description: string;
  repo: string;
  default?: boolean;
}

const TEMPLATES: Template[] = [
  {
    name: "starter",
    description:
      "Full-featured Next.js app with Val, TypeScript, Tailwind CSS, and examples",
    repo: "valbuild/template-nextjs-starter",
    default: true,
  },
];

const DEFAULT_PROJECT_NAME = "my-val-app";

function printHelp() {
  console.log(`
${chalk.bold("Usage:")}
  ${chalk.cyan("npm create @valbuild [project-name]")}
  ${chalk.cyan("pnpm create @valbuild [project-name]")}

${chalk.bold("Options:")}
  -h, --help Show help
  -v, --version Show version
  --root <path> Specify the root directory for project creation (default: current directory)
  --use-npm, --use-pnpm, --use-yarn, --use-bun Use this package manager instead of the one that ran this command
  --package-manager <${PACKAGE_MANAGERS.join(
    "|",
  )}> Same, spelled out (--pm also works)
  --mcp, --no-mcp Serve Val's content tools over MCP, so coding agents can edit your content (asked if not given)
  --image-uploads, --no-image-uploads Let those agents upload images. Adds sharp (asked if not given)

${chalk.dim(
  "By default the package manager that ran this command is used, so `pnpm create @valbuild` installs with pnpm.",
)}
`);
}

function printVersion() {
  console.log(`${PKG.name} v${PKG.version}`);
}

function handleExit() {
  console.log(chalk.yellow("\nAborted."));
  process.exit(0);
}

process.on("SIGINT", handleExit);

// Timeline stepper logic
const timelineSteps = [
  "Enter project name",
  "Choose features",
  "Download template",
  "Install dependencies",
  "Complete!",
];

type StepStatus = "pending" | "active" | "done" | "error";

function renderTimeline(currentStep: number, errorStep?: number) {
  const icons = {
    pending: chalk.gray("◯"),
    active: chalk.cyan("◉"),
    done: chalk.green("✔"),
    error: chalk.red("✖"),
  };
  let out = "\n";
  for (let i = 0; i < timelineSteps.length; i++) {
    let status: StepStatus = "pending";
    if (errorStep !== undefined && i === errorStep) status = "error";
    else if (i < currentStep) status = "done";
    else if (i === currentStep) status = "active";
    const icon = icons[status];
    out += `  ${icon} ${timelineSteps[i]}\n`;
    if (i < timelineSteps.length - 1) out += `  ${chalk.gray("│")}\n`;
  }
  process.stdout.write("\x1b[2J\x1b[0f"); // clear screen
  displayValLogo();
  process.stdout.write(out + "\n");
}

function displayValLogo() {
  const logo = chalk.cyan(`
###########
###########
###########                           @@@@
###########                             @@
###########    @@      @@  @@@@@@ @     @@
###########     @@    @@  @@     @@     @@
###########     @@    @@ %@       @     @@
####  #####      @@  @@  .@      .@     @@
###    ####       @@@@    @@:   @@@.    @@
####  #####       @@@@      @@@@  =@@@@@@@@@
###########
`);
  process.stdout.write(logo);
}

function displaySuccessMessage(
  projectName: string,
  packageManager: PackageManager,
  features: Features,
) {
  const commands = PACKAGE_MANAGER_COMMANDS[packageManager];
  // Printed only when the endpoint is actually there, and with the URL rather
  // than a pointer to the README: attaching an agent is one command, and a
  // command someone can paste is the difference between using the feature and
  // meaning to.
  const mcpStep = features.mcp
    ? `
${chalk.bold("Attach a coding agent to your content:")}
  ${chalk.cyan("claude mcp add --transport http val http://localhost:3000/api/mcp")}
`
    : "";
  const nextSteps = chalk.bold(`
${chalk.cyan("Next steps:")}
  ${chalk.cyan("cd")} ${chalk.white(projectName)}
  ${chalk.cyan(`${commands.run} dev`)}
${mcpStep}
${chalk.bold("Optionally run:")}
  ${chalk.cyan(`${commands.valCli} connect`)}  
${chalk.bold("to connect your project to Val Build")}

${chalk.bold("Need help?")} Join our community on Discord: ${chalk.underline(
    "https://discord.gg/cZzqPvaX8k",
  )}

${chalk.green("Happy coding! 🚀")}
`);

  process.stdout.write(nextSteps);
}

/**
 * The two optional parts of the template, asked for unless a flag already said.
 *
 * Both default to yes. The MCP endpoint costs a project nothing it would notice
 * — it refuses to serve on a deployed host in local filesystem mode, so the
 * default is safe as well as useful — and an agent that can read a project's
 * schemas is most of the value of having them. `sharp` is called out by name
 * because it is the one answer with a cost a person might not want: a compiled
 * binary per platform, in a project that may never upload an image.
 */
async function chooseFeatures(given: Partial<Features>): Promise<Features> {
  const mcp =
    given.mcp ??
    (await confirm({
      message: chalk.bold(
        "Serve Val's content tools over MCP, so coding agents can read and edit your content?",
      ),
      default: true,
    }));
  const imageUploads = !mcp
    ? // Not asked when there is no endpoint to serve it on. A flag that asked
      // for it anyway is not ignored — `reconcile` says so below.
      (given.imageUploads ?? false)
    : (given.imageUploads ??
      (await confirm({
        message: chalk.bold(
          `Let them upload images too? ${chalk.dim(
            "(adds sharp, a native image library, to your dependencies)",
          )}`,
        ),
        default: true,
      })));
  const reconciled = reconcile({ mcp, imageUploads });
  if (reconciled.warning !== null) {
    console.log(chalk.yellow(reconciled.warning));
  }
  return reconciled.features;
}

/** True, or the reason this is not a usable project name. */
function validateProjectName(value: string): true | string {
  if (!value || value.trim().length === 0) {
    return "Project name cannot be empty";
  }
  if (value.includes(" ")) {
    return "Project name cannot contain spaces";
  }
  if (!/^[a-zA-Z0-9-_]+$/.test(value)) {
    return "Project name can only contain letters, numbers, hyphens, and underscores";
  }
  return true;
}

// Template processing function
function processTemplateFiles(projectPath: string, projectName: string) {
  const filesToProcess = [
    "package.json",
    "README.md",
    "next.config.js",
    "val.config.ts",
    "val.config.js",
  ];

  filesToProcess.forEach((filename) => {
    const filePath = join(projectPath, filename);
    if (existsSync(filePath)) {
      try {
        let content = readFileSync(filePath, "utf-8");
        // Replace both {{PROJECT_NAME}} and {{projectName}} placeholders
        content = content.replace(/\{\{PROJECT_NAME\}\}/g, projectName);
        content = content.replace(/\{\{projectName\}\}/g, projectName);
        writeFileSync(filePath, content, "utf-8");
      } catch {
        // Silently continue if file can't be processed
        console.log(chalk.dim(`Note: Could not process ${filename}`));
      }
    }
  });
}

/**
 * Drop the lock files of every package manager but the one we are about to use.
 *
 * The template commits a lock file for one package manager. Left in place, it
 * is at best noise — pnpm, yarn and bun all ignore `package-lock.json` while
 * writing their own lock file — and at worst a stale second source of truth
 * that `npm ci` in a deploy pipeline would prefer.
 */
function pruneForeignLockFiles(
  projectPath: string,
  packageManager: PackageManager,
) {
  for (const lockFile of foreignLockFiles(packageManager)) {
    const lockFilePath = join(projectPath, lockFile);
    if (existsSync(lockFilePath)) {
      try {
        rmSync(lockFilePath);
      } catch {
        console.log(chalk.dim(`Note: Could not remove ${lockFile}`));
      }
    }
  }
}

async function main() {
  try {
    const args = process.argv.slice(2);
    if (args.includes("-h") || args.includes("--help")) {
      printHelp();
      process.exit(0);
    }
    if (args.includes("-v") || args.includes("--version")) {
      printVersion();
      process.exit(0);
    }

    // Parse --root option
    const rootIndex = args.findIndex((a) => a === "--root");
    let rootDir = process.cwd();
    if (rootIndex !== -1 && args[rootIndex + 1]) {
      rootDir = args[rootIndex + 1];
      // Remove --root and its value from args for project name parsing
      args.splice(rootIndex, 2);
    }

    // Answers given on the command line, so the prompts below only ask what is
    // still open. Taken out of `args` first, or the project name would be
    // whichever of them came first.
    const flags = parseFeatureFlags(args);
    if (flags.contradiction !== null) {
      console.error(
        chalk.red(`❌ Error: ${flags.contradiction} cannot both be given.`),
      );
      process.exit(1);
    }

    // Which package manager to install with: a flag if given, otherwise the
    // one that ran this command.
    const resolved = resolvePackageManager(
      flags.rest,
      process.env.npm_config_user_agent,
    );
    if (resolved.invalidFlag !== null) {
      console.error(
        chalk.red(
          `❌ Error: unknown package manager "${resolved.invalidFlag}".`,
        ),
      );
      console.error(
        chalk.yellow(
          `Supported package managers: ${PACKAGE_MANAGERS.join(", ")}`,
        ),
      );
      process.exit(1);
    }
    const packageManager = resolved.packageManager;
    const commands = PACKAGE_MANAGER_COMMANDS[packageManager];

    // The help text has always advertised `[project-name]`: whatever is left
    // once the flags are out is it.
    const projectNameArg = resolved.rest[0];
    if (projectNameArg !== undefined) {
      const invalid = validateProjectName(projectNameArg);
      if (invalid !== true) {
        console.error(chalk.red(`❌ Error: ${invalid}.`));
        process.exit(1);
      }
    }

    let currentStep = 0;
    renderTimeline(currentStep);

    // Step 1: Enter project name — unless it was given as an argument
    const projectName =
      projectNameArg ??
      (await input({
        message: chalk.bold("What is your project named?"),
        default: DEFAULT_PROJECT_NAME,
        validate: validateProjectName,
      }));
    currentStep++;
    renderTimeline(currentStep);

    // Step 2: Which optional parts of the template to keep
    const features = await chooseFeatures(flags.answers);
    currentStep++;
    renderTimeline(currentStep);

    const selectedTemplate = TEMPLATES[0];

    // Step 3: Download template
    const projectPath = join(rootDir, projectName);
    if (existsSync(projectPath)) {
      renderTimeline(currentStep, currentStep);
      console.error(
        chalk.red(`❌ Error: Directory "${projectName}" already exists.`),
      );
      console.error(
        chalk.yellow(
          "Please choose a different name or remove the existing directory.",
        ),
      );
      process.exit(1);
    }
    mkdirSync(projectPath, { recursive: true });
    process.stdout.write(
      chalk.bold("\n📥 Downloading template from GitHub...\n") +
        `  ${chalk.dim(`https://github.com/${selectedTemplate.repo}`)}\n`,
    );

    try {
      const emitter = degit(selectedTemplate.repo, {
        cache: false,
        force: true,
        verbose: false,
      });
      await emitter.clone(projectPath);
    } catch (error) {
      renderTimeline(currentStep, currentStep);
      console.error(chalk.red("❌ Failed to download template:"));
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("rate limit") || errorMessage.includes("403")) {
        console.error(
          chalk.yellow(
            "GitHub rate limit exceeded. Please try again later or authenticate with GitHub.",
          ),
        );
      } else if (
        errorMessage.includes("not found") ||
        errorMessage.includes("404")
      ) {
        console.error(
          chalk.yellow(
            `Template repository not found: ${selectedTemplate.repo}`,
          ),
        );
        console.error(
          chalk.yellow("Please check if the repository exists and is public."),
        );
      } else {
        console.error(
          chalk.yellow("Network error. Please check your internet connection."),
        );
      }
      console.error(chalk.dim("Error details:"), errorMessage);
      process.exit(1);
    }

    currentStep++;
    renderTimeline(currentStep);
    process.stdout.write(
      chalk.green(
        `✅ Successfully downloaded template from ${selectedTemplate.repo}!\n`,
      ),
    );

    // Process template files
    processTemplateFiles(projectPath, projectName);
    // Before the install, because this is what decides which dependencies the
    // install has to fetch — `sharp` in particular, which is a compiled binary
    // and not something to download and then throw away.
    applyFeatures(projectPath, features);
    pruneForeignLockFiles(projectPath, packageManager);

    // Change to project directory and install dependencies
    process.stdout.write(
      chalk.bold(`\n📦 Installing dependencies with ${packageManager}...\n`),
    );
    if (resolved.source !== "flag") {
      process.stdout.write(
        chalk.dim(
          "  Use --use-npm, --use-pnpm, --use-yarn or --use-bun to pick another package manager.\n",
        ),
      );
    }

    try {
      execSync(commands.install, {
        cwd: projectPath,
        stdio: "inherit", // Show install output in real-time
      });

      // Clear the npm output and show success
      process.stdout.write("\x1b[2J\x1b[0f"); // clear screen
      displayValLogo();
      currentStep++;
      renderTimeline(currentStep);
      process.stdout.write(
        chalk.green(
          `✅ Successfully downloaded template from ${selectedTemplate.repo}!\n`,
        ),
      );
      process.stdout.write(
        chalk.green("\n✅ Dependencies installed successfully!\n"),
      );

      // Show final success message
      displaySuccessMessage(projectName, packageManager, features);
      process.stdout.write("\n");
      process.exit(0);
    } catch (error) {
      renderTimeline(currentStep, currentStep);
      console.error(
        chalk.red(
          `❌ Failed to install dependencies. You can try running "${commands.install}" manually.`,
        ),
      );
      console.error("Error:", error);
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red("❌ Failed to create project:"), error);
    process.exit(1);
  }
}

main();

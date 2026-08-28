import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import degit from "degit";
import { input } from "@inquirer/prompts";
import chalk from "chalk";
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
) {
  const commands = PACKAGE_MANAGER_COMMANDS[packageManager];
  const nextSteps = chalk.bold(`
${chalk.cyan("Next steps:")}
  ${chalk.cyan("cd")} ${chalk.white(projectName)}
  ${chalk.cyan(`${commands.run} dev`)}

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

    // Which package manager to install with: a flag if given, otherwise the
    // one that ran this command.
    const resolved = resolvePackageManager(
      args,
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

    // Step 2: Select template
    const selectedTemplate = TEMPLATES[0];
    currentStep++;
    renderTimeline(currentStep);

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
      displaySuccessMessage(projectName, packageManager);
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

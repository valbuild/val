#!/usr/bin/env node

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import degit from "degit";
import { input } from "@inquirer/prompts";
import chalk from "chalk";

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

${chalk.bold("Options:")}
  -h, --help Show help
  -v, --version Show version
  --root <path> Specify the root directory for project creation (default: current directory)
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

function displayHeading() {
  const heading = chalk.bold.cyan(`
╔══════════════════════════════════════════════════════════════╗
║                    Creating Val Project                      ║
╚══════════════════════════════════════════════════════════════╝
`);
  process.stdout.write(heading);
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

function displaySuccessMessage(projectName: string, templateRepo: string) {
  const nextSteps = chalk.bold(`
${chalk.cyan("Next steps:")}
  ${chalk.cyan("cd")} ${chalk.white(projectName)}
  ${chalk.cyan("npm run dev")}

${chalk.green("Happy coding! 🚀")}
`);

  process.stdout.write(nextSteps);
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
      } catch (error) {
        // Silently continue if file can't be processed
        console.log(chalk.dim(`Note: Could not process ${filename}`));
      }
    }
  });
}

async function main() {
  try {
    console.log("here");
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

    let currentStep = 0;
    renderTimeline(currentStep);

    // Step 1: Enter project name
    const projectName = await input({
      message: chalk.bold("What is your project named?"),
      default: DEFAULT_PROJECT_NAME,
      validate: (value) => {
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
      },
    });
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

    // Change to project directory and install dependencies
    process.stdout.write(chalk.bold("\n📦 Installing dependencies...\n"));

    try {
      execSync("npm install", {
        cwd: projectPath,
        stdio: "inherit", // Show npm output in real-time
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
      displaySuccessMessage(projectName, selectedTemplate.repo);
    } catch (error) {
      renderTimeline(currentStep, currentStep);
      console.error(
        chalk.red(
          '❌ Failed to install dependencies. You can try running "npm install" manually.',
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

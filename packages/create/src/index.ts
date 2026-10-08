import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import degit from "degit";
import { confirm, input, select } from "@inquirer/prompts";
import chalk from "chalk";
import { applyFeatures, type Features } from "./features";
import { parseFeatureFlags, reconcile } from "./featureFlags";
import { pruneTemplateRepoFiles } from "./templateRepoFiles";
import {
  DEFAULT_FRAMEWORK,
  dropUnsupportedFeatures,
  FRAMEWORK_NAMES,
  FRAMEWORKS,
  parseFrameworkArgs,
  parseTemplateArgs,
  resolveTemplateArg,
  type Framework,
  type TemplateArg,
} from "./framework";
import {
  type CatalogTemplate,
  fetchCatalog,
  TEMPLATES_REPO,
  templateSource,
  templatesRef,
  templateUrl,
} from "./catalog";
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
  --framework <${FRAMEWORKS.join(
    "|",
  )}> Which framework to build on (asked if not given)
  --tanstack, --nextjs Same, as a shorthand
  --template <id> Which template: ${chalk.cyan("full")} or ${chalk.cyan("minimal")}, or an id like ${chalk.cyan("tanstack-full")} (asked if not given)
  --use-npm, --use-pnpm, --use-yarn, --use-bun Use this package manager instead of the one that ran this command
  --package-manager <${PACKAGE_MANAGERS.join(
    "|",
  )}> Same, spelled out (--pm also works)
  --mcp, --no-mcp Serve Val's content tools over MCP, so coding agents can edit your content (asked if not given)
  --image-uploads, --no-image-uploads Let those agents upload images. Adds sharp (asked if not given)

${chalk.dim(
  "By default the package manager that ran this command is used, so `pnpm create @valbuild` installs with pnpm.",
)}
${chalk.dim(
  `Templates come from https://github.com/${TEMPLATES_REPO}. Set VAL_TEMPLATES_REF to a branch to try one before it lands.`,
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
  "Choose framework",
  "Choose template",
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
async function chooseFeatures(
  given: Partial<Features>,
  template: CatalogTemplate,
): Promise<Features> {
  if (template.features.mcp === undefined) {
    // Nothing to ask: neither question has anything to turn on in this
    // template. A flag that asked anyway is reported rather than ignored.
    const narrowed = dropUnsupportedFeatures(
      { mcp: given.mcp ?? false, imageUploads: given.imageUploads ?? false },
      template,
    );
    if (narrowed.warning !== null) {
      console.log(chalk.yellow(narrowed.warning));
    }
    return narrowed.features;
  }
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
    : template.features.imageUploads === undefined
      ? // Nothing to turn on in this template; `dropUnsupportedFeatures`
        // below reports a flag that asked anyway.
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
  const narrowed = dropUnsupportedFeatures(reconciled.features, template);
  if (narrowed.warning !== null) {
    console.log(chalk.yellow(narrowed.warning));
  }
  return narrowed.features;
}

/**
 * Which framework to build on, asked unless a flag already said.
 *
 * First, because everything after it depends on the answer: which templates
 * there are to pick from, and which of the optional features they have files
 * for. Only frameworks the catalog has a template for are offered.
 */
async function chooseFramework(
  given: Framework | null,
  templates: CatalogTemplate[],
): Promise<Framework> {
  if (given) {
    return given;
  }
  const offered = FRAMEWORKS.filter((framework) =>
    templates.some((template) => template.framework === framework),
  );
  return await select({
    message: chalk.bold("Which framework?"),
    choices: offered.map((framework) => ({
      name: FRAMEWORK_NAMES[framework],
      value: framework,
    })),
    default: offered.includes(DEFAULT_FRAMEWORK)
      ? DEFAULT_FRAMEWORK
      : offered[0],
  });
}

/**
 * Which of that framework's templates, asked unless `--template` said.
 *
 * In the catalog's order, which is the order the templates repository chose,
 * and the first is the default.
 */
async function chooseTemplate(
  framework: Framework,
  templates: CatalogTemplate[],
  given: TemplateArg | null,
): Promise<CatalogTemplate> {
  if (given !== null) {
    const resolved =
      given.status === "needs-framework"
        ? resolveTemplateArg(given.name, templates, framework)
        : given;
    if (resolved.status === "ok") {
      return resolved.template;
    }
    if (resolved.status === "error") {
      throw new CreateError(resolved.message);
    }
  }
  const offered = templates.filter(
    (template) => template.framework === framework,
  );
  if (offered.length === 0) {
    throw new CreateError(
      `There is no ${FRAMEWORK_NAMES[framework]} template to create a project from.`,
    );
  }
  return await select({
    message: chalk.bold("Which template?"),
    choices: offered.map((template) => ({
      name: template.name,
      value: template,
      description: template.description,
    })),
    default: offered[0],
  });
}

/** A mistake in what was asked for: printed as it is, with no stack. */
class CreateError extends Error {}

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
    "vite.config.ts",
    "tsr.config.json",
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

    // Which template, if a flag said. First, because its value is a bare word
    // (`--template full`) that would otherwise be read as the project name.
    const templateArgs = parseTemplateArgs(resolved.rest);
    if (templateArgs.invalidFlag !== null) {
      console.error(
        chalk.red(
          `❌ Error: ${templateArgs.invalidFlag} needs a template, e.g. --template full.`,
        ),
      );
      process.exit(1);
    }

    // Which framework, if a flag said. Taken out of `args` before the project
    // name for the same reason the others are.
    const frameworkArgs = parseFrameworkArgs(templateArgs.rest);
    if (frameworkArgs.invalidFlag !== null) {
      console.error(
        chalk.red(
          `❌ Error: unknown framework "${frameworkArgs.invalidFlag}".`,
        ),
      );
      console.error(
        chalk.yellow(`Supported frameworks: ${FRAMEWORKS.join(", ")}`),
      );
      process.exit(1);
    }

    // The help text has always advertised `[project-name]`: whatever is left
    // once the flags are out is it.
    const projectNameArg = frameworkArgs.rest[0];
    if (projectNameArg !== undefined) {
      const invalid = validateProjectName(projectNameArg);
      if (invalid !== true) {
        console.error(chalk.red(`❌ Error: ${invalid}.`));
        process.exit(1);
      }
    }

    // What there is to create. Before the first question, so the questions
    // offer exactly what the templates repository has.
    const ref = templatesRef(process.env);
    const fetched = await fetchCatalog(ref);
    if (fetched.status === "error") {
      console.error(chalk.red(`❌ Error: ${fetched.message}`));
      if (fetched.details) {
        console.error(chalk.dim("Details:"), fetched.details);
      }
      process.exit(1);
    }
    const templates = fetched.catalog.templates;

    // An id names the framework too, so `--template tanstack-full` is enough.
    const givenTemplate =
      templateArgs.template === null
        ? null
        : resolveTemplateArg(
            templateArgs.template,
            templates,
            frameworkArgs.framework,
          );
    if (givenTemplate?.status === "error") {
      console.error(chalk.red(`❌ Error: ${givenTemplate.message}`));
      process.exit(1);
    }
    const givenFramework =
      givenTemplate?.status === "ok"
        ? givenTemplate.template.framework
        : frameworkArgs.framework;

    let currentStep = 0;
    renderTimeline(currentStep);

    // Step 1: Which framework — unless a flag already said
    const framework = await chooseFramework(givenFramework, templates);
    currentStep++;
    renderTimeline(currentStep);

    // Step 2: Which template — unless a flag already said
    const selectedTemplate = await chooseTemplate(
      framework,
      templates,
      givenTemplate,
    );
    currentStep++;
    renderTimeline(currentStep);

    // Step 3: Enter project name — unless it was given as an argument
    const projectName =
      projectNameArg ??
      (await input({
        message: chalk.bold("What is your project named?"),
        default: DEFAULT_PROJECT_NAME,
        validate: validateProjectName,
      }));
    currentStep++;
    renderTimeline(currentStep);

    // Step 4: Which optional parts of the template to keep
    const features = await chooseFeatures(flags.answers, selectedTemplate);
    currentStep++;
    renderTimeline(currentStep);

    // Step 5: Download template
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
        `  ${chalk.dim(templateUrl(selectedTemplate, ref))}\n`,
    );

    try {
      const emitter = degit(templateSource(selectedTemplate, ref), {
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
            `Template not found: ${templateUrl(selectedTemplate, ref)}`,
          ),
        );
        console.error(
          chalk.yellow(
            "The template list names it, so the list and the repository disagree. Try again in a minute, or with a different template.",
          ),
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
        `✅ Downloaded the ${FRAMEWORK_NAMES[selectedTemplate.framework]} ${selectedTemplate.name} template\n`,
      ),
    );

    // Process template files
    processTemplateFiles(projectPath, projectName);
    // Before the install, because this is what decides which dependencies the
    // install has to fetch — `sharp` in particular, which is a compiled binary
    // and not something to download and then throw away.
    const removedFeatures = applyFeatures(
      projectPath,
      features,
      selectedTemplate.features,
    );
    pruneForeignLockFiles(projectPath, packageManager);
    // The template's own CI, which is about the template rather than about
    // anything in this new project. See `templateRepoFiles.ts`.
    pruneTemplateRepoFiles(projectPath);

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
      // After the install, because the script is the template's own and
      // runs its own tools: TanStack's route tree imports every route file,
      // including the ones a declined feature just took away.
      if (removedFeatures && selectedTemplate.regenerate) {
        regenerate(projectPath, commands.run, selectedTemplate.regenerate);
      }

      // Clear the npm output and show success
      process.stdout.write("\x1b[2J\x1b[0f"); // clear screen
      displayValLogo();
      currentStep++;
      renderTimeline(currentStep);
      process.stdout.write(
        chalk.green(
          `✅ Downloaded the ${FRAMEWORK_NAMES[selectedTemplate.framework]} ${selectedTemplate.name} template\n`,
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
    if (error instanceof CreateError) {
      console.error(chalk.red(`❌ Error: ${error.message}`));
      process.exit(1);
    }
    console.error(chalk.red("❌ Failed to create project:"), error);
    process.exit(1);
  }
}

/**
 * Bring the template's generated files up to date with what is left.
 *
 * Not fatal: the files are regenerated anyway the first time the dev server or
 * the build runs. What it saves is the first `typecheck`, or the editor,
 * reporting imports of files that are not there.
 */
function regenerate(
  projectPath: string,
  run: string,
  step: { script: string; files: string[] },
) {
  try {
    execSync(`${run} ${step.script}`, { cwd: projectPath, stdio: "pipe" });
  } catch {
    console.log(
      chalk.yellow(
        `Note: could not run "${run} ${step.script}". ${step.files.join(", ")} will be brought up to date the first time you run the dev server.`,
      ),
    );
  }
}

main();

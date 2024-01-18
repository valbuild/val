import chalk from "chalk";

export function error(message: string) {
  console.error(chalk.red("❌ ERROR: ") + message);
}

export function warn(message: string) {
  console.error(chalk.yellow("⚠️  WARN:") + message);
}

export function info(
  message: string,
  opts: { isCodeSnippet?: true; isGood?: true } = {}
) {
  if (opts.isCodeSnippet) {
    console.log(chalk.cyanBright("$ >        ") + chalk.cyan(message));
    return;
  }
  if (opts.isGood) {
    console.log(chalk.green("✅      ") + message);
    return;
  }
  console.log(message);
}

export function debugPrint(str: string) {
  /*eslint-disable no-constant-condition */
  if (process.env["DEBUG"] || true) {
    // TODO: remove true
    console.log(`DEBUG: ${str}`);
  }
}

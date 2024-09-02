import chalk from "chalk";

export function error(message: string) {
  console.error(chalk.red("❌Error: ") + message);
}

export function info(
  message: string,
  opts: { isCodeSnippet?: true; isGood?: true } = {},
) {
  if (opts.isCodeSnippet) {
    console.log(chalk.cyanBright("$ > ") + chalk.cyan(message));
    return;
  }
  if (opts.isGood) {
    console.log(chalk.green("✅: ") + message);
    return;
  }
  console.log(chalk.blue("️ℹ️ : ") + message);
}

export function debugPrint(str: string) {
  /*eslint-disable no-constant-condition */
  if (process.env["DEBUG"] || true) {
    // TODO: remove true
    console.log(`DEBUG: ${str}`);
  }
}

export function printDebuggingHelp() {
  info(
    `If you're having trouble, please follow the debugging steps\n🌐: https://val.build/docs/troubleshooting`,
  );
}

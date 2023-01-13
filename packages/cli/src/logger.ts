import chalk from "chalk";

export function error(...message: string[]) {
  console.error(chalk.red(...message));
}

export function info(...message: string[]) {
  console.log(...message);
}

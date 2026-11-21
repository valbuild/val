import { execFileSync } from "child_process";
import path from "path";

/**
 * Runs a probe in `__fixtures__` with tsx and returns what it printed last as
 * JSON.
 *
 * A separate process because `@rolldown/browser` is ESM-only and jest runs
 * CommonJS here. tsx's WASI warnings share stdout's stream in some shells, so
 * this takes the last line that parses rather than assuming the output is
 * only JSON.
 */
export function runProbe<T>(file: string): T {
  const out = execFileSync(
    path.join(__dirname, "..", "..", "node_modules", ".bin", "tsx"),
    [path.join(__dirname, file)],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const line = out
    .trim()
    .split("\n")
    .reverse()
    .find((candidate) => candidate.startsWith("{"));
  if (line === undefined) {
    throw new Error(`${file} printed no result:\n${out}`);
  }
  return JSON.parse(line);
}

import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { COMMAND_HELP, USAGE, requestedHelp, type Command } from "./help";

/**
 * `--help` prints help, and runs nothing.
 *
 * meow answers `--help` only when it is the whole command line, so
 * `val publish --help` reached `publish`: with credentials, a build, an upload
 * and a live site moved, by someone asking what the command does.
 */
const commands = Object.keys(COMMAND_HELP) as Array<Command>;

describe("requestedHelp", () => {
  test.each(commands)("%s --help is that command's help", (command) => {
    expect(requestedHelp([command], { help: true })).toBe(
      COMMAND_HELP[command],
    );
  });

  test("idate is validate", () => {
    expect(requestedHelp(["idate"], { help: true })).toBe(
      COMMAND_HELP.validate,
    );
  });

  test("everything, for no command or one that does not exist", () => {
    expect(requestedHelp([], { help: true })).toBe(USAGE);
    expect(requestedHelp(["bogus"], { help: true })).toBe(USAGE);
  });

  test("nothing when it was not asked for", () => {
    expect(requestedHelp(["publish"], {})).toBeNull();
  });

  test("the full help lists every command, with its own help", () => {
    for (const command of commands) {
      expect(USAGE).toContain(`  ${command}\n`);
      expect(USAGE).toContain(COMMAND_HELP[command]);
    }
  });
});

describe("the CLI", () => {
  const tsx = path.join(__dirname, "..", "node_modules", ".bin", "tsx");
  const cli = path.join(__dirname, "cli.ts");
  let cwd: string;
  beforeAll(() => {
    // An empty directory: any command that ran would fail here, loudly.
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "val-cli-help-"));
  });
  afterAll(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  const run = (args: Array<string>) =>
    spawnSync(tsx, [cli, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, VAL_PROJECT_TOKEN: "", VAL_API_KEY: "" },
    });

  test.each([
    [["publish", "--help"], "publish"],
    [["publish", "-h"], "publish"],
    [["publish", "--dry-run", "--help"], "publish"],
    [["validate", "--fix", "--help"], "validate"],
    [
      ["delete-unappliable-patches", "--yes", "--help"],
      "delete-unappliable-patches",
    ],
  ] as const)(
    "%j prints help and exits 0",
    (args, command) => {
      const result = run([...args]);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(COMMAND_HELP[command] + "\n");
      expect(result.status).toBe(0);
    },
    60_000,
  );

  test("--help alone prints all of it", () => {
    expect(execFileSync(tsx, [cli, "--help"], { cwd, encoding: "utf8" })).toBe(
      USAGE + "\n",
    );
  }, 60_000);
});

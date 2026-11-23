import {
  COMMAND_HELP,
  commandHelp,
  decideCliAction,
  fullHelp,
  type CliAction,
} from "./help";

describe("decideCliAction", () => {
  const helpFor = (command: keyof typeof COMMAND_HELP): CliAction => ({
    type: "help",
    text: commandHelp(command),
    exitCode: 0,
  });

  test("a help flag after a command shows that command's help instead of running it", () => {
    expect(decideCliAction(["publish"], { help: true })).toEqual(
      helpFor("publish"),
    );
    expect(decideCliAction(["validate"], { help: true })).toEqual(
      helpFor("validate"),
    );
  });

  test("an alias resolves to the command it runs", () => {
    expect(decideCliAction(["idate"], { help: true })).toEqual(
      helpFor("validate"),
    );
    expect(decideCliAction(["idate"], {})).toEqual({
      type: "run",
      command: "validate",
    });
  });

  test("a help flag on its own shows every command", () => {
    expect(decideCliAction([], { help: true })).toEqual({
      type: "help",
      text: fullHelp(),
      exitCode: 0,
    });
  });

  test("`val help` and `val help <command>`", () => {
    expect(decideCliAction(["help"], {})).toEqual({
      type: "help",
      text: fullHelp(),
      exitCode: 0,
    });
    expect(decideCliAction(["help", "publish"], {})).toEqual(
      helpFor("publish"),
    );
  });

  test("help for a command that does not exist says so, and fails", () => {
    for (const action of [
      decideCliAction(["nope"], { help: true }),
      decideCliAction(["help", "nope"], {}),
    ]) {
      expect(action).toEqual({
        type: "help",
        text: fullHelp(),
        exitCode: 2,
        error: 'Unknown command "nope"',
      });
    }
  });

  test("a version flag after a command prints the version instead of running it", () => {
    expect(decideCliAction(["publish"], { version: true })).toEqual({
      type: "version",
    });
    expect(decideCliAction([], { version: true })).toEqual({
      type: "version",
    });
  });

  test("help wins over version", () => {
    expect(decideCliAction(["publish"], { help: true, version: true })).toEqual(
      helpFor("publish"),
    );
  });

  test("no command shows every command, and is not a success", () => {
    expect(decideCliAction([], {})).toEqual({
      type: "help",
      text: fullHelp(),
      exitCode: 2,
    });
  });

  test("commands run when nothing asks for help or the version", () => {
    expect(
      decideCliAction(["publish"], { help: false, version: false }),
    ).toEqual({ type: "run", command: "publish" });
    expect(decideCliAction(["nope"], {})).toEqual({
      type: "unknown-command",
      input: ["nope"],
    });
    expect(decideCliAction(["publish", "extra"], {})).toEqual({
      type: "unknown-command",
      input: ["publish", "extra"],
    });
  });
});

describe("fullHelp", () => {
  test("lists every command, each with its own section", () => {
    const text = fullHelp();
    for (const command of Object.keys(COMMAND_HELP)) {
      expect(text).toContain(`Command: ${command}\n`);
    }
  });
});

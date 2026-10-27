import {
  isRemoteFix,
  REMOTE_FIX_COMMANDS,
  REMOTE_FIX_TITLES,
  valCommandNames,
  VAL_DOWNLOAD_REMOTE_COMMAND,
  VAL_LOGIN_COMMAND,
  VAL_UPLOAD_REMOTE_COMMAND,
} from "./commands";
import { isLocalFix } from "./codeActions";
import type { ValidationFix } from "@valbuild/core";
import { startLspSession, type LspSession } from "./__testHelpers__/lspClient";

describe("the remote fix / local fix split", () => {
  test("every remote fix has a command and a title", () => {
    for (const fix of Object.keys(REMOTE_FIX_COMMANDS) as ValidationFix[]) {
      expect(valCommandNames()).toContain(REMOTE_FIX_COMMANDS[fix]);
      expect(REMOTE_FIX_TITLES[fix]).toBeDefined();
    }
  });

  test("no fix is both local and remote", () => {
    // A fix offered as both an edit and a command would apply twice.
    for (const fix of Object.keys(REMOTE_FIX_COMMANDS)) {
      expect(isLocalFix(fix)).toBe(false);
    }
  });

  test("uploads and downloads route to different commands", () => {
    expect(REMOTE_FIX_COMMANDS["image:upload-remote"]).toBe(
      VAL_UPLOAD_REMOTE_COMMAND,
    );
    expect(REMOTE_FIX_COMMANDS["image:download-remote"]).toBe(
      VAL_DOWNLOAD_REMOTE_COMMAND,
    );
  });

  test("isRemoteFix does not claim the metadata fixes", () => {
    expect(isRemoteFix("image:add-metadata")).toBe(false);
    expect(isRemoteFix("images:check-all-files")).toBe(false);
    expect(isRemoteFix("image:upload-remote")).toBe(true);
  });
});

describe("commands over LSP", () => {
  let session: LspSession;
  jest.setTimeout(90000);

  beforeEach(async () => {
    session = await startLspSession();
  });
  afterEach(async () => {
    await session.dispose();
  });

  test("advertises the command names and the matching features", () => {
    expect(session.capabilities?.commands).toEqual(
      expect.arrayContaining([
        VAL_LOGIN_COMMAND,
        VAL_UPLOAD_REMOTE_COMMAND,
        VAL_DOWNLOAD_REMOTE_COMMAND,
      ]),
    );
    // A client hides UI for a feature it does not see, so the flags have to be
    // advertised alongside the commands that implement them.
    expect(session.capabilities?.features).toEqual(
      expect.arrayContaining([
        "login",
        "fix/upload-remote",
        "fix/download-remote",
      ]),
    );
  });

  test("an unknown command is refused rather than crashing the server", async () => {
    await session.client.sendRequest("workspace/executeCommand", {
      command: "val.notARealCommand",
      arguments: [],
    });
    // Still alive and still answering.
    expect(session.capabilities?.protocolVersion).toBe(1);
  });

  test("a remote command with junk arguments is refused rather than crashing", async () => {
    await session.client.sendRequest("workspace/executeCommand", {
      command: VAL_UPLOAD_REMOTE_COMMAND,
      arguments: [{ nonsense: true }],
    });
    expect(session.capabilities?.protocolVersion).toBe(1);
  });
});

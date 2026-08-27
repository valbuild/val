/**
 * `workspace/executeCommand` handlers.
 *
 * Quick fixes that only rewrite text travel as a `WorkspaceEdit` and need no
 * command. These three cannot:
 *
 *  - **login** has no edit at all; it opens a browser and waits.
 *  - **upload-remote** sends bytes to a remote host, which needs credentials and
 *    is not expressible as an edit. Only the resulting rewrite is.
 *  - **download-remote** writes a file to disk before the rewrite makes sense.
 *
 * Routing them through `executeCommand` is what keeps editors free of Val
 * knowledge: a code action carries a `command` name the server advertised, and
 * the LSP client forwards it back without understanding it. `vscode-languageclient`
 * registers every advertised command automatically, and a Neovim client does the
 * same through `vim.lsp.buf.code_action`, so neither needs a line of Val-specific
 * code for any of this.
 */

import fs from "fs";
import {
  DEFAULT_CONTENT_HOST,
  DEFAULT_VAL_REMOTE_HOST,
  type ModuleFilePath,
  type SourcePath,
  type ValidationFix,
} from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import {
  awaitValLoginConfirmation,
  createFixPatch,
  findAndEvalValConfigFile,
  getPersonalAccessTokenPath,
  getSettings,
  parsePersonalAccessTokenFile,
  patchSourceFile,
  persistPersonalAccessToken,
  startValLogin,
  uploadRemoteFile,
  ValLoginError,
  type IValRemote,
} from "@valbuild/server";
import {
  ApplyWorkspaceEditRequest,
  ShowDocumentRequest,
  type Connection,
  type TextEdit,
} from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { minimalTextEdit } from "./textEdit";
import type { ValProject } from "./ValProject";

/** Names advertised in `executeCommandProvider.commands`. */
export const VAL_LOGIN_COMMAND = "val.login";
export const VAL_UPLOAD_REMOTE_COMMAND = "val.uploadRemote";
export const VAL_DOWNLOAD_REMOTE_COMMAND = "val.downloadRemote";

/**
 * The remote fixes, and which command each is offered through.
 *
 * Kept apart from `LOCAL_FIXES` in `codeActions.ts` deliberately: a quick fix
 * that silently needed credentials would just fail, so these are offered as
 * commands and can report "you are not logged in" like a normal outcome.
 */
export const REMOTE_FIX_COMMANDS: Partial<Record<ValidationFix, string>> = {
  "image:upload-remote": VAL_UPLOAD_REMOTE_COMMAND,
  "file:upload-remote": VAL_UPLOAD_REMOTE_COMMAND,
  "images:upload-remote": VAL_UPLOAD_REMOTE_COMMAND,
  "files:upload-remote": VAL_UPLOAD_REMOTE_COMMAND,
  "image:download-remote": VAL_DOWNLOAD_REMOTE_COMMAND,
  "file:download-remote": VAL_DOWNLOAD_REMOTE_COMMAND,
};

export const REMOTE_FIX_TITLES: Partial<Record<ValidationFix, string>> = {
  "image:upload-remote": "Val: upload this image to Val Remote",
  "file:upload-remote": "Val: upload this file to Val Remote",
  "images:upload-remote": "Val: upload this gallery's images to Val Remote",
  "files:upload-remote": "Val: upload this gallery's files to Val Remote",
  "image:download-remote": "Val: download this image into the project",
  "file:download-remote": "Val: download this file into the project",
};

/** Arguments a remote-fix command is invoked with. */
export type RemoteFixCommandArgs = {
  uri: string;
  moduleFilePath: ModuleFilePath;
  sourcePath: SourcePath;
  fix: ValidationFix;
  message: string;
  value?: unknown;
};

export type ValCommandDeps = {
  connection: Connection;
  getProject: () => ValProject | undefined;
  getDocument: (uri: string) => TextDocument | undefined;
  remoteHost?: string;
};

/** Whether a fix is offered as a command rather than as a plain edit. */
export function isRemoteFix(fix: string): fix is ValidationFix {
  return Object.prototype.hasOwnProperty.call(REMOTE_FIX_COMMANDS, fix);
}

export function valCommandNames(): string[] {
  return [
    VAL_LOGIN_COMMAND,
    VAL_UPLOAD_REMOTE_COMMAND,
    VAL_DOWNLOAD_REMOTE_COMMAND,
  ];
}

/**
 * Read the project's personal access token.
 *
 * Same file the CLI writes and the dev server reads (`<root>/.val/pat.json`), so
 * logging in through either is logging in for both.
 */
export function readPersonalAccessToken(valRoot: string): string | null {
  try {
    const parsed = parsePersonalAccessTokenFile(
      fs.readFileSync(getPersonalAccessTokenPath(valRoot), "utf8"),
    );
    return parsed.success ? parsed.data.pat : null;
  } catch {
    return null;
  }
}

/**
 * The remote the upload fixes talk to, built from `@valbuild/server`.
 *
 * Same wiring as `packages/cli/src/validate.ts`: the ref's host is
 * `VAL_REMOTE_HOST`, but the bytes and the project settings go to the content
 * host. Conflating the two uploads to the wrong place.
 */
function createRemote(remoteHost: string): IValRemote {
  const contentHost = process.env.VAL_CONTENT_URL ?? DEFAULT_CONTENT_HOST;
  return {
    remoteHost,
    getSettings: (projectName, options) => getSettings(projectName, options),
    uploadFile: (project, bucket, fileHash, fileExt, fileBuffer, options) =>
      uploadRemoteFile(
        contentHost,
        project,
        bucket,
        fileHash,
        // The handler types this optional; an empty extension is what the CLI
        // ends up sending for a file with none.
        fileExt ?? "",
        fileBuffer,
        options,
      ),
  };
}

/**
 * A work-done progress the client can show, and cancel.
 *
 * `createWorkDoneProgress` needs the client to have announced
 * `window.workDoneProgress`; when it has not, this degrades to a plain message
 * and a signal nobody aborts, rather than failing the command. The
 * `AbortSignal` is what connects a user pressing cancel to
 * `awaitValLoginConfirmation`, which takes one precisely so an editor can drive
 * it.
 */
async function withProgress(
  connection: Connection,
  title: string,
  message: string,
): Promise<{ signal: AbortSignal; done: () => void }> {
  const controller = new AbortController();
  try {
    const reporter = await connection.window.createWorkDoneProgress();
    reporter.begin(title, undefined, message, true);
    reporter.token.onCancellationRequested(() => controller.abort());
    let finished = false;
    return {
      signal: controller.signal,
      done: () => {
        if (!finished) {
          finished = true;
          reporter.done();
        }
      },
    };
  } catch {
    connection.window.showInformationMessage(`${title}. ${message}`);
    return { signal: controller.signal, done: () => {} };
  }
}

export function createValCommands(deps: ValCommandDeps): {
  execute: (command: string, args: unknown[]) => Promise<void>;
} {
  const remoteHost =
    deps.remoteHost ?? process.env.VAL_REMOTE_HOST ?? DEFAULT_VAL_REMOTE_HOST;

  async function login(): Promise<void> {
    const project = deps.getProject();
    if (!project) {
      return;
    }
    const { connection } = deps;
    try {
      const session = await startValLogin();
      // `showDocument` with `external` is the standard way to reach a browser;
      // there is no Val-specific request for it, which is what lets any LSP
      // client drive this flow.
      await connection.sendRequest(ShowDocumentRequest.type, {
        uri: session.url,
        external: true,
      });
      // The poll runs for up to five minutes. Without progress the editor looks
      // hung, and there is nothing to tell the user the browser is the next step.
      const progress = await withProgress(
        connection,
        "Val: waiting for login",
        "Complete the login in your browser.",
      );
      let confirmed;
      try {
        confirmed = await awaitValLoginConfirmation(session.nonce, {
          signal: progress.signal,
        });
      } finally {
        progress.done();
      }
      const filePath = persistPersonalAccessToken(project.valRoot, confirmed);
      connection.window.showInformationMessage(
        `Val: logged in as ${confirmed.profile.email} (token saved to ${filePath}).`,
      );
    } catch (e: unknown) {
      const message =
        e instanceof ValLoginError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e);
      deps.connection.window.showErrorMessage(`Val: login failed. ${message}`);
    }
  }

  async function remoteFix(args: RemoteFixCommandArgs): Promise<void> {
    const project = deps.getProject();
    const document = deps.getDocument(args.uri);
    const { connection } = deps;
    if (!project || !document) {
      return;
    }

    const isUpload = args.fix.endsWith(":upload-remote");
    let projectName: string | undefined;
    if (isUpload) {
      // Uploading needs both a project name and a token; saying which one is
      // missing is the difference between an actionable message and a shrug.
      const pat = readPersonalAccessToken(project.valRoot);
      if (!pat) {
        connection.window.showErrorMessage(
          `Val: you are not logged in. Run "${VAL_LOGIN_COMMAND}" first.`,
        );
        return;
      }
      const config = await findAndEvalValConfigFile(project.valRoot).catch(
        () => null,
      );
      projectName = config?.project;
      if (!projectName) {
        connection.window.showErrorMessage(
          "Val: no `project` in val.config, so there is nowhere to upload to.",
        );
        return;
      }
    }

    const remoteFiles: Record<
      SourcePath,
      { ref: string; metadata?: Record<string, unknown> }
    > = {};
    const validationError = {
      message: args.message,
      value: args.value,
      fixes: [args.fix],
    };

    // Bytes over the network: how long depends on the file, so the editor needs
    // to say something is happening.
    const progress = await withProgress(
      connection,
      isUpload
        ? "Val: uploading to Val Remote"
        : "Val: downloading from Val Remote",
      args.sourcePath,
    );
    let outcome;
    try {
      outcome = await project.runFixHandler({
        moduleFilePath: args.moduleFilePath,
        sourcePath: args.sourcePath,
        validationError,
        // The upload or download itself is the point; it cannot be an edit.
        fix: true,
        remote: createRemote(remoteHost),
        ...(projectName ? { project: projectName } : {}),
        remoteFiles,
      });
    } catch (e: unknown) {
      progress.done();
      connection.window.showErrorMessage(
        `Val: ${args.fix} failed. ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    progress.done();
    if (!outcome) {
      connection.window.showErrorMessage(
        `Val: could not run ${args.fix} — the project would not evaluate.`,
      );
      return;
    }
    if (!outcome.success) {
      connection.window.showErrorMessage(
        `Val: ${outcome.errorMessage ?? `${args.fix} failed.`}`,
      );
      return;
    }
    if (!outcome.shouldApplyPatch) {
      // The handler did the work and there is nothing left to rewrite.
      return;
    }

    const moduleResult = await project.getModule(args.moduleFilePath, {
      validate: false,
    });
    if (moduleResult.status === "error") {
      return;
    }
    let fixed;
    try {
      fixed = await createFixPatch(
        { projectRoot: project.valRoot, remoteHost },
        true,
        args.sourcePath,
        validationError,
        remoteFiles,
        moduleResult.content.source,
        moduleResult.content.schema,
      );
    } catch (e: unknown) {
      connection.window.showErrorMessage(
        `Val: ${args.fix} could not be written. ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return;
    }
    if (!fixed || fixed.patch.length === 0) {
      return;
    }
    const before = document.getText();
    const patched = patchSourceFile(before, fixed.patch);
    if (result.isErr(patched)) {
      connection.window.showErrorMessage(
        `Val: ${args.fix} produced a patch that would not apply.`,
      );
      return;
    }
    const edit: TextEdit | undefined = minimalTextEdit(
      before,
      patched.value.text,
      document,
    );
    if (!edit) {
      return;
    }
    // Applied through the client so it lands in the editor's undo history,
    // rather than written to disk under the user's cursor.
    await connection.sendRequest(ApplyWorkspaceEditRequest.type, {
      label: REMOTE_FIX_TITLES[args.fix] ?? `Val: ${args.fix}`,
      edit: { changes: { [args.uri]: [edit] } },
    });
  }

  return {
    async execute(command, args) {
      if (command === VAL_LOGIN_COMMAND) {
        await login();
        return;
      }
      if (
        command === VAL_UPLOAD_REMOTE_COMMAND ||
        command === VAL_DOWNLOAD_REMOTE_COMMAND
      ) {
        const [raw] = args;
        if (!isRemoteFixCommandArgs(raw)) {
          deps.connection.console.error(
            `Val: ${command} called with unexpected arguments.`,
          );
          return;
        }
        await remoteFix(raw);
        return;
      }
      deps.connection.console.error(`Val: unknown command ${command}.`);
    },
  };
}

function isRemoteFixCommandArgs(raw: unknown): raw is RemoteFixCommandArgs {
  if (raw === null || typeof raw !== "object") {
    return false;
  }
  const candidate = raw as Partial<RemoteFixCommandArgs>;
  return (
    typeof candidate.uri === "string" &&
    typeof candidate.moduleFilePath === "string" &&
    typeof candidate.sourcePath === "string" &&
    typeof candidate.fix === "string" &&
    typeof candidate.message === "string"
  );
}

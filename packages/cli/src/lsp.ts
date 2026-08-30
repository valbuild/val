/**
 * Start the Val language server.
 *
 * Editors normally resolve `@valbuild/language-server` from the project's
 * `node_modules` and launch its `val-language-server` binary directly. This
 * subcommand exists so the server is discoverable from the CLI and easy to
 * start by hand when debugging an editor integration:
 *
 *     npx val lsp --stdio
 *
 * The import is dynamic so that `vscode-languageserver` is not loaded on every
 * `val` invocation.
 */
export async function lsp(): Promise<void> {
  const { main } = await import("@valbuild/language-server");
  // Transport (`--stdio`, `--node-ipc`, `--socket=`) is read from argv by the
  // server itself, so the flags pass straight through.
  main();
}

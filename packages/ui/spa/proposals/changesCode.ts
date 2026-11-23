/**
 * The tools that change the proposal's code: refused while code mode is off.
 * Reading it, typechecking it and building what is staged change nothing.
 *
 * In a file of its own, with no imports: the assistant's socket asks it for
 * the turn trace (`aiTurnTrace.ts`), and importing it from `proposalCode`
 * would put the code tools' whole graph in front of the Studio's first load.
 */
export function changesCode(
  name: string,
  input: Record<string, unknown>,
): boolean {
  if (name === "write_files" || name === "edit_file") return true;
  if (name === "format_files") return input["write"] !== false;
  if (name === "lint") return input["fix"] === true;
  return false;
}

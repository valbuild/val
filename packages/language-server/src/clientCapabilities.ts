/**
 * What the client announced it will do with a `WorkspaceEdit`.
 *
 * A resource operation — a file created, renamed or deleted as part of an edit —
 * is silently DROPPED by a client that did not announce it. The rest of the edit
 * still applies, so a fix that needs one and is offered anyway leaves the
 * project in a state that is worse than the one it set out to fix: a `.val.ts`
 * rewritten to import a file that was never created, a path rewritten to a file
 * that never moved. Hence: probe first, and do not offer the action at all.
 *
 * Read defensively. These come from `InitializeParams.capabilities`, which is
 * whatever the client sent — this is the one place that has to cope with the
 * field being absent or the wrong shape.
 */
export function supportsResourceOperation(
  capabilities: unknown,
  operation: "create" | "rename" | "delete",
): boolean {
  const workspace = (
    capabilities as
      | {
          workspace?: {
            workspaceEdit?: { resourceOperations?: unknown };
          };
        }
      | undefined
  )?.workspace;
  const operations = workspace?.workspaceEdit?.resourceOperations;
  return Array.isArray(operations) && operations.includes(operation);
}

import { createProjectSourceReader } from "@valbuild/shared/internal";
import { createProjectSnapshot, type ProjectSnapshot } from "./projectSnapshot";
import { createProposalsClient, type ProposalsClient } from "./proposalsClient";

/**
 * What the assistant's code tools reach Val's server through, made once for
 * the life of the chat (`useAI`): the proposals client, the site's source by
 * version, and the snapshot of the project the tools read from.
 */
export type CodeClients = {
  proposals: ProposalsClient;
  /**
   * The site's source, by version: sent whole only when a publish changed
   * it. Not the publish client's, which holds its first answer for as long
   * as it lives -- one deploy there, and the chat's whole life here, so a
   * publish in between went unseen by the code tools.
   */
  siteSource: () => Promise<Record<string, string> | null>;
  /**
   * The project the code tools read, held and asked for again only when the
   * project's `seq` says it moved: see `projectSnapshot.ts`. Nothing is
   * read until a tool asks.
   */
  snapshot: ProjectSnapshot;
};

export function createCodeClients(options: {
  /** This deployment's Val API, e.g. `/api/val`. */
  api: string;
  /** The project's `seq` as this tab holds it (`ManifestSource.seq`). */
  seq: () => number | null;
  fetchImpl?: typeof fetch;
}): CodeClients {
  const at = {
    api: options.api,
    ...(options.fetchImpl !== undefined
      ? { fetchImpl: options.fetchImpl }
      : {}),
  };
  const proposals = createProposalsClient(at);
  const siteSource = createProjectSourceReader(at);
  return {
    proposals,
    siteSource,
    snapshot: createProjectSnapshot({
      client: proposals,
      siteSource,
      seq: options.seq,
    }),
  };
}

import type { ValConfig, ValModule, SelectorSource } from "@valbuild/core";
import { createWorld, type World } from "./createWorld";
import type { CodeToolAnswer } from "../../../packages/ui/spa/proposals/proposalCode";
import { reportCodeMode } from "../../../packages/ui/spa/proposals/codeMode";

/**
 * A proposal `</>` made, in code mode, with a site's code in it: what the
 * code-mode scenarios start from (`codeModeTasks.scenario.test.ts`, and the
 * catalogue's `codeModeCatalogue.scenario.test.ts`).
 *
 * `code` is the site's code by project path, and `modules` the content
 * modules the world runs, with `moduleText` their `.val.ts` text by module
 * path. The site's last publish left the platform holding all of it as the
 * live build's files, which the code tools read by version.
 */
export async function openCodeModeProposal(options: {
  config: ValConfig;
  modules: ValModule<SelectorSource>[];
  moduleText: Record<string, string>;
  code: Record<string, string>;
}) {
  const world = await createWorld({
    config: options.config,
    modules: options.modules,
    server: "http",
    sourceText: {
      ...options.moduleText,
      ...Object.fromEntries(
        Object.entries(options.code).map(([path, text]) => [`/${path}`, text]),
      ),
    },
    proposal: { open: "Code mode" },
  });
  const proposal = world.proposal;
  if (proposal === null) throw new Error("not at a proposal's address");
  if (world.server.mode !== "http") throw new Error("not on http");
  const published = await fetch(
    `${world.server.contentUrl}/__test__/project-source`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        files: {
          ...Object.fromEntries(
            Object.entries(options.moduleText).map(([path, text]) => [
              path.replace(/^\//, ""),
              text,
            ]),
          ),
          ...options.code,
        },
      }),
    },
  );
  if (!published.ok) throw new Error(`project-source: ${published.status}`);
  const editor = await world.studio("editor");
  const turned = await proposal.codeMode(true);
  // What `useProposalsBar` does with the proposal it reads.
  reportCodeMode({
    name: proposal.name,
    displayName: turned.displayName,
    on: true,
  });
  await world.settle();
  return { world, proposal, editor, assistant: proposal.assistant(editor) };
}

/** The build lands at the address, and the Studio has time to react. */
export async function buildLands(
  world: World,
  options?: Parameters<NonNullable<World["proposal"]>["redeploy"]>[0],
): Promise<void> {
  await world.proposal?.redeploy(options);
  await world.clock.advance(21_000);
  await world.settle();
  await world.clock.advance(4_000);
  await world.settle();
}

/** A tool's answer, narrowed: it succeeded, and this is what it said. */
export function ok(answer: CodeToolAnswer): Record<string, unknown> {
  expect(answer.isError ? JSON.stringify(answer.result) : "ok").toBe("ok");
  return Object(answer.result);
}

import type { Meta, StoryObj } from "@storybook/react";
import {
  initVal,
  Internal,
  Json,
  ModuleFilePath,
  PatchId,
  ReifiedPreview,
  SerializedSchema,
} from "@valbuild/core";
import { ValClient } from "@valbuild/shared/internal";
import { Patch } from "@valbuild/core/patch";
import { useMemo, useState } from "react";
import { ComparePatchSets } from "./ComparePatchSets";
import { Profile } from "./ValProvider";
import { PatchSets, SerializedPatchSet } from "../utils/PatchSets";
import type { ValEnrichedDeployment } from "../utils/mergeCommitsAndDeployments";
import { createStorySystem } from "../stores/react/storySystem";
import type { System } from "../stores/createSystem";
import { ValSystemProvider } from "../stores/react/SystemContext";
import { PatchStagingProvider } from "./PatchStagingProvider";
import { ValThemeProvider, Themes } from "./ValThemeProvider";
import { ValErrorProvider } from "./ValErrorProvider";
import { ValPortalProvider } from "./ValPortalProvider";
import { ValFieldProvider } from "./ValFieldProvider";
import { ValRouter } from "./ValRouter";
import { ValRemoteProvider } from "./ValRemoteProvider";
import { TooltipProvider } from "./designSystem/tooltip";
import { placeholderAvatar } from "./stories/placeholderAssets";

// --- Mock client ---

function createMockClient(): ValClient {
  return ((path: string, method: string, req: unknown) => {
    if (path === "/patches" && method === "PUT") {
      const body = (req as { body?: { patches?: Record<string, unknown[]> } })
        ?.body;
      const newPatchIds: string[] = [];
      if (body?.patches) {
        for (const entries of Object.values(body.patches)) {
          for (let i = 0; i < (entries as unknown[]).length; i++) {
            newPatchIds.push(`mock-patch-${Date.now()}-${i}`);
          }
        }
      }
      return Promise.resolve({
        status: 200,
        json: { newPatchIds },
      });
    }
    return Promise.resolve({
      status: 200,
      json: {
        schemas: {},
        sources: {},
        config: { project: "storybook-test" },
      },
    });
  }) as unknown as ValClient;
}

// --- Mock data helpers ---

function createMockData(
  modules: ReturnType<ReturnType<typeof initVal>["c"]["define"]>[],
) {
  const schemas: Record<string, SerializedSchema> = {};
  const sources: Record<string, Json> = {};
  const previews: Record<string, ReifiedPreview> = {};

  for (const module of modules) {
    const moduleFilePath = Internal.getValPath(module);
    const schema = Internal.getSchema(module);
    const source = Internal.getSource(module);

    if (moduleFilePath && schema && source !== undefined) {
      const path = moduleFilePath as unknown as ModuleFilePath;
      schemas[path] = schema["executeSerialize"]();
      sources[path] = source;
      previews[path] = schema["executePreview"](path, source);
    }
  }
  return {
    schemas: schemas as Record<ModuleFilePath, SerializedSchema>,
    sources: sources as Record<ModuleFilePath, Json>,
    previews: previews as Record<ModuleFilePath, ReifiedPreview>,
  };
}

type TestPatch = {
  patch: Patch;
  createdAt: string;
  author: string | null;
};

/**
 * Apply each test patch to the engine so the optimistic source diverges from
 * the server source — this is what lets the diff view render a real
 * "Before / After". The IDs returned by the engine are stitched into the
 * SerializedPatchSet metadata so the per-row Discard button targets real
 * pending patches.
 */
function applyPatchesAndSerialize(
  system: System,
  moduleFilePath: ModuleFilePath,
  serializedSchema: SerializedSchema,
  patches: TestPatch[],
): { patchSets: SerializedPatchSet; patchIds: PatchId[] } {
  const patchSets = new PatchSets();
  const patchIds: PatchId[] = [];
  for (const p of patches) {
    /**
     * The id is minted first and handed in, so it is known without awaiting.
     *
     * `createPatch` is async because a patch CAN carry file bytes, but these
     * carry none — so it records the patch and emits `patch:create`, which is
     * what applies it to source, before it reaches its first await. The story's
     * fixture is therefore complete by the time this loop ends, which is what
     * lets it be built in a `useMemo` rather than in state behind an effect.
     */
    const realPatchId = system.patchStore.mintPatchId();
    patchIds.push(realPatchId);
    void system.patchStore.createPatch(
      moduleFilePath,
      p.patch,
      undefined,
      undefined,
      undefined,
      realPatchId,
    );
    patchSets.insert(
      moduleFilePath,
      serializedSchema,
      p.patch,
      realPatchId,
      p.createdAt,
      p.author,
    );
  }
  return { patchSets: patchSets.serialize(), patchIds };
}

// --- StoryProviders ---

type MockData = {
  schemas: Record<ModuleFilePath, SerializedSchema>;
  sources: Record<ModuleFilePath, Json>;
  previews: Record<ModuleFilePath, ReifiedPreview>;
};

function makeSystem(mockData: MockData): System {
  return createStorySystem({
    schemas: mockData.schemas,
    sources: mockData.sources,
    previews: mockData.previews,
  });
}

function StoryProviders({
  children,
  system,
}: {
  children: React.ReactNode;
  system: System;
}) {
  const [theme, setTheme] = useState<Themes | null>("dark");
  const getDirectFileUploadSettings = useMemo(
    () => async () => ({
      status: "success" as const,
      data: {
        nonce: null,
        baseUrl: "https://mock-upload.example.com",
        contentBaseUrl: null,
        contentAuthNonce: null,
      },
    }),
    [],
  );

  return (
    <ValSystemProvider system={system}>
      <ValThemeProvider theme={theme} setTheme={setTheme} config={undefined}>
        <TooltipProvider>
          <ValRouter>
            <ValErrorProvider>
              <ValPortalProvider>
                <ValFieldProvider
                  getDirectFileUploadSettings={getDirectFileUploadSettings}
                  config={undefined}
                >
                  <ValRemoteProvider
                    remoteFiles={{
                      status: "inactive",
                      message: "Storybook mock",
                      reason: "project-not-configured",
                    }}
                  >
                    {children}
                  </ValRemoteProvider>
                </ValFieldProvider>
              </ValPortalProvider>
            </ValErrorProvider>
          </ValRouter>
        </TooltipProvider>
      </ValThemeProvider>
    </ValSystemProvider>
  );
}

/**
 * Sets up an engine seeded with `mockData`, applies the supplied patches
 * (so server vs optimistic diverge), and renders the story with the engine.
 */
function StorySetup({
  mockData,
  patches,
  moduleFilePath,
  serializedSchema,
  canDiscard,
  committedCount = 0,
  deployment,
  staging,
  initiallyHeld,
}: {
  mockData: MockData;
  patches: TestPatch[];
  moduleFilePath: ModuleFilePath;
  serializedSchema: SerializedSchema;
  canDiscard?: boolean;
  /**
   * How many of the supplied patches have already shipped in a commit.
   *
   * The FIRST n, because `patches` is in chain order and a publish takes the
   * oldest end of the chain. Those land below the deploy line with their discard
   * controls gone; anything after them stays discardable.
   */
  committedCount?: number;
  /**
   * The deploy the divider describes. Passed explicitly — including as `null` —
   * because the connected version reads `ValContext`, which these stories do not
   * mount. See `ComparePatchSets`.
   */
  deployment?: ValEnrichedDeployment | null;
  /**
   * Enable the stage / unstage affordance. Off by default so the existing
   * stories keep showing the plain review screen, which is also what FS mode and
   * any content API without patch group support will render.
   */
  staging?: boolean;
  /**
   * Patch indexes (into `patches`) to start unstaged, so a story can open
   * directly on a mixed state instead of needing a click to get there.
   */
  initiallyHeld?: number[];
}) {
  const client = useMemo(() => createMockClient(), []);
  const { system, patchSets, patchIds, committedPatchIds } = useMemo(() => {
    const system = makeSystem(mockData);
    const { patchSets, patchIds } = applyPatchesAndSerialize(
      system,
      moduleFilePath,
      serializedSchema,
      patches,
    );
    return {
      system,
      patchSets,
      patchIds,
      committedPatchIds: new Set(patchIds.slice(0, committedCount)),
    };
  }, [
    client,
    mockData,
    moduleFilePath,
    serializedSchema,
    patches,
    committedCount,
  ]);

  // A group holds everything pending by default; `initiallyHeld` carves some out.
  const [group, setGroup] = useState<Set<PatchId>>(
    () =>
      new Set(
        patchIds.filter((_, index) => !(initiallyHeld ?? []).includes(index)),
      ),
  );

  return (
    <StoryProviders system={system}>
      <PatchStagingProvider
        enabled={staging ?? false}
        patchSets={patchSets}
        chainOrder={patchIds}
        group={group}
        onChange={(next, change) => {
          setGroup(next);
          // Stands in for the PUT/DELETE on /patch-groups/~/patches. Logged so the
          // story shows what the closure moved, which is the part that is easy to
          // get wrong and invisible in the rendered output.
          console.log("patch group change", change);
        }}
      >
        <ComparePatchSets
          patchSets={patchSets}
          profilesByAuthorIds={mockProfiles}
          canDiscard={canDiscard}
          committedPatchIds={committedPatchIds}
          deployment={committedCount > 0 ? (deployment ?? null) : undefined}
        />
      </PatchStagingProvider>
    </StoryProviders>
  );
}

// --- Schema & content setup ---

const { s, c } = initVal();

const MODULE_FILE_PATH = "/app/pages.val.ts" as ModuleFilePath;

const pagesModule = c.define(
  "/app/pages.val.ts",
  s.record(
    s.object({
      title: s.string(),
      body: s.richtext(),
      status: s.union(
        s.literal("draft"),
        s.literal("published"),
        s.literal("archived"),
      ),
      sections: s.array(
        s.object({
          heading: s.string(),
          items: s.array(
            s.union(
              "type",
              s.object({ type: s.literal("text"), content: s.string() }),
              s.object({ type: s.literal("quote"), text: s.string() }),
            ),
          ),
        }),
      ),
    }),
  ),
  {
    "/home": {
      title: "Welcome Home",
      body: [{ tag: "p", children: ["Welcome to our site."] }],
      status: "draft",
      sections: [
        {
          heading: "Hero",
          items: [{ type: "text", content: "Check out our latest features." }],
        },
        {
          heading: "About",
          items: [{ type: "text", content: "We are a team of builders." }],
        },
      ],
    },
    "/about": {
      title: "About Us",
      body: [{ tag: "p", children: ["Learn more about our team."] }],
      status: "published",
      sections: [
        {
          heading: "Team",
          items: [{ type: "text", content: "Our talented crew." }],
        },
      ],
    },
  },
);

const mockData = createMockData([pagesModule]);
const serializedSchema = mockData.schemas[MODULE_FILE_PATH];

const ROUTER_MODULE_FILE_PATH = "/app/[slug]/page.val.ts" as ModuleFilePath;

const routerPagesModule = c.define(
  "/app/[slug]/page.val.ts",
  s.router(
    Internal.nextAppRouter,
    s.object({
      title: s.string(),
      body: s.richtext(),
    }),
  ),
  {
    "/home": {
      title: "Welcome Home",
      body: [{ tag: "p", children: ["Welcome to our site."] }],
    },
    "/about": {
      title: "About Us",
      body: [{ tag: "p", children: ["Learn more about our team."] }],
    },
    "/contact": {
      title: "Contact",
      body: [{ tag: "p", children: ["Get in touch."] }],
    },
  },
);

const routerMockData = createMockData([routerPagesModule]);
const routerSerializedSchema = routerMockData.schemas[ROUTER_MODULE_FILE_PATH];

const mockProfiles: Record<string, Profile> = {
  alice: { fullName: "Alice Andersen", avatar: null },
  bob: {
    fullName: "Bob Bakke",
    avatar: { url: placeholderAvatar("bob", 150) },
  },
  carol: { fullName: "Carol Chen", avatar: null },
  dan: { fullName: "Dan Hansen", avatar: null },
  eve: { fullName: "Eve Johansen", avatar: null },
};

// --- Storybook meta ---

const meta: Meta<typeof ComparePatchSets> = {
  title: "Components/ComparePatchSets",
  component: ComparePatchSets,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="p-8 bg-bg-tertiary min-h-screen">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ComparePatchSets>;

// --- Stories ---

/**
 * The flagship story: a desktop review with several patch sets across one
 * module. Exercises field-level edits (side-by-side), a wholesale add (single
 * column, green rail) and a wholesale remove (single column, red rail with
 * line-through), plus the avatar stack in the summary strip.
 */
export const DesktopReview: Story = {
  render: () => (
    <StorySetup
      mockData={mockData}
      moduleFilePath={MODULE_FILE_PATH}
      serializedSchema={serializedSchema}
      patches={[
        {
          patch: [
            {
              op: "replace",
              path: ["/home", "title"],
              value: "Welcome Home — Updated",
            },
          ],
          createdAt: "2025-04-03T08:00:00Z",
          author: "alice",
        },
        {
          patch: [
            {
              op: "replace",
              path: ["/home", "status"],
              value: "published",
            },
          ],
          createdAt: "2025-04-03T08:05:00Z",
          author: "alice",
        },
        {
          patch: [
            {
              op: "replace",
              path: ["/home", "sections", "1", "items", "0", "content"],
              value: "Updated nested item content",
            },
          ],
          createdAt: "2025-04-05T10:10:00Z",
          author: "bob",
        },
        {
          patch: [
            {
              op: "add",
              path: ["/contact"],
              value: {
                title: "Contact Us",
                body: [{ tag: "p", children: ["Get in touch with our team."] }],
                status: "draft",
                sections: [
                  {
                    heading: "Office",
                    items: [
                      {
                        type: "text",
                        content: "123 Main St, Oslo, Norway",
                      },
                    ],
                  },
                ],
              },
            },
          ],
          createdAt: "2025-04-01T10:00:00Z",
          author: "alice",
        },
        {
          patch: [
            {
              op: "remove",
              path: ["/about"],
            },
          ],
          createdAt: "2025-04-02T09:00:00Z",
          author: "bob",
        },
      ]}
    />
  ),
};

// --- The deploy line ---

/** A publish that is on its way out, as GitHub reports it while building. */
const buildingDeployment: ValEnrichedDeployment = {
  deploymentState: "pending",
  commitMessage: "Update landing page copy",
  creator: "alice",
  commitSha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  createdAt: "2025-04-05T10:20:00Z",
  updatedAt: "2025-04-05T10:22:00Z",
};

/** The same publish, once the host reports it live. */
const liveDeployment: ValEnrichedDeployment = {
  ...buildingDeployment,
  deploymentState: "success",
};

const failedDeployment: ValEnrichedDeployment = {
  ...buildingDeployment,
  deploymentState: "failure",
};

const deployLinePatches: TestPatch[] = [
  {
    patch: [{ op: "replace", path: ["/home", "title"], value: "Welcome Home" }],
    createdAt: "2025-04-03T08:00:00Z",
    author: "alice",
  },
  {
    patch: [{ op: "replace", path: ["/home", "status"], value: "published" }],
    createdAt: "2025-04-03T08:05:00Z",
    author: "alice",
  },
  {
    patch: [
      {
        op: "replace",
        path: ["/about", "title"],
        value: "About Us — Updated",
      },
    ],
    createdAt: "2025-04-06T09:00:00Z",
    author: "bob",
  },
];

/**
 * The summary strip, with everything still discardable.
 *
 * The count and the discard-all sit above the changes, which is where the view
 * itself now puts them — the strip used to be the surrounding screen's job, and
 * the shell never had anywhere to put it.
 */
export const WithSummaryStrip: Story = {
  render: () => (
    <StorySetup
      mockData={mockData}
      moduleFilePath={MODULE_FILE_PATH}
      serializedSchema={serializedSchema}
      canDiscard
      patches={deployLinePatches}
    />
  ),
};

/**
 * Two published patches deploying, one edit made since.
 *
 * The divider sits between them: above it the newer edit is still discardable,
 * below it the module is dashed, its discard control replaced by a lock, and the
 * strip offers to discard one change rather than three.
 */
export const DeployingBelowDivider: Story = {
  render: () => (
    <StorySetup
      mockData={mockData}
      moduleFilePath={MODULE_FILE_PATH}
      serializedSchema={serializedSchema}
      canDiscard
      committedCount={2}
      deployment={buildingDeployment}
      patches={deployLinePatches}
    />
  ),
};

/**
 * Everything has shipped and the deploy has landed.
 *
 * Nothing above the line, so the strip says so rather than dropping its button
 * without explanation. The section stays until the server drops the patches from
 * the chain — see `ComparePatchSets`.
 */
export const AllDeployedAndLive: Story = {
  render: () => (
    <StorySetup
      mockData={mockData}
      moduleFilePath={MODULE_FILE_PATH}
      serializedSchema={serializedSchema}
      canDiscard
      committedCount={3}
      deployment={liveDeployment}
      patches={deployLinePatches}
    />
  ),
};

/**
 * The deploy failed, and the patches are still not discardable.
 *
 * The commit exists either way, which is the whole reason: there is nothing a
 * Discard button below this line could honestly do.
 */
export const DeployFailed: Story = {
  render: () => (
    <StorySetup
      mockData={mockData}
      moduleFilePath={MODULE_FILE_PATH}
      serializedSchema={serializedSchema}
      canDiscard
      committedCount={2}
      deployment={failedDeployment}
      patches={deployLinePatches}
    />
  ),
};

/** The same review at 360px: two-row strip, banner divider, stacked diffs. */
export const DeployingOnAPhone: Story = {
  parameters: { viewport: { defaultViewport: "mobile1" } },
  decorators: [
    (Story) => (
      <div className="w-[360px] bg-bg-tertiary min-h-screen p-3">
        <Story />
      </div>
    ),
  ],
  render: () => (
    <StorySetup
      mockData={mockData}
      moduleFilePath={MODULE_FILE_PATH}
      serializedSchema={serializedSchema}
      canDiscard
      committedCount={2}
      deployment={buildingDeployment}
      patches={deployLinePatches}
    />
  ),
};

export const PageAdded: Story = {
  render: () => (
    <StorySetup
      mockData={mockData}
      moduleFilePath={MODULE_FILE_PATH}
      serializedSchema={serializedSchema}
      patches={[
        {
          patch: [
            {
              op: "add",
              path: ["/contact"],
              value: {
                title: "Contact Us",
                body: [{ tag: "p", children: ["Get in touch with our team."] }],
                status: "draft",
                sections: [
                  {
                    heading: "Office",
                    items: [
                      { type: "text", content: "123 Main St, Oslo, Norway" },
                    ],
                  },
                ],
              },
            },
          ],
          createdAt: "2025-04-01T10:00:00Z",
          author: "alice",
        },
      ]}
    />
  ),
};

export const PageRemoved: Story = {
  render: () => (
    <StorySetup
      mockData={mockData}
      moduleFilePath={MODULE_FILE_PATH}
      serializedSchema={serializedSchema}
      patches={[
        {
          patch: [{ op: "remove", path: ["/about"] }],
          createdAt: "2025-04-02T09:00:00Z",
          author: "bob",
        },
      ]}
    />
  ),
};

export const PageUpdated: Story = {
  render: () => (
    <StorySetup
      mockData={mockData}
      moduleFilePath={MODULE_FILE_PATH}
      serializedSchema={serializedSchema}
      patches={[
        {
          patch: [
            {
              op: "replace",
              path: ["/home", "title"],
              value: "Welcome Home — Updated",
            },
          ],
          createdAt: "2025-04-03T08:00:00Z",
          author: "alice",
        },
        {
          patch: [
            {
              op: "replace",
              path: ["/home", "status"],
              value: "published",
            },
          ],
          createdAt: "2025-04-03T08:05:00Z",
          author: "alice",
        },
      ]}
    />
  ),
};

export const PageUpdatedEditable: Story = {
  render: () => (
    <StorySetup
      mockData={mockData}
      moduleFilePath={MODULE_FILE_PATH}
      serializedSchema={serializedSchema}
      canDiscard
      patches={[
        {
          patch: [
            {
              op: "replace",
              path: ["/home", "title"],
              value: "Welcome Home — Updated",
            },
          ],
          createdAt: "2025-04-03T08:00:00Z",
          author: "alice",
        },
        {
          patch: [
            {
              op: "replace",
              path: ["/home", "status"],
              value: "published",
            },
          ],
          createdAt: "2025-04-03T08:05:00Z",
          author: "alice",
        },
      ]}
    />
  ),
};

export const RichtextUpdated: Story = {
  render: () => (
    <StorySetup
      mockData={mockData}
      moduleFilePath={MODULE_FILE_PATH}
      serializedSchema={serializedSchema}
      patches={[
        {
          patch: [
            {
              op: "replace",
              path: ["/home", "body"],
              value: [
                { tag: "h1", children: ["Welcome to our new site"] },
                {
                  tag: "p",
                  children: [
                    "We have completely redesigned our homepage. ",
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Check it out!"],
                    },
                  ],
                },
              ],
            },
          ],
          createdAt: "2025-04-04T14:00:00Z",
          author: "carol",
        },
      ]}
    />
  ),
};

export const ManyAuthorsAvatarOverflow: Story = {
  render: () => (
    <StorySetup
      mockData={mockData}
      moduleFilePath={MODULE_FILE_PATH}
      serializedSchema={serializedSchema}
      patches={[
        {
          patch: [{ op: "replace", path: ["/home", "title"], value: "v3" }],
          createdAt: "2025-04-08T09:00:00Z",
          author: "alice",
        },
        {
          patch: [
            {
              op: "replace",
              path: ["/home", "status"],
              value: "published",
            },
          ],
          createdAt: "2025-04-08T09:30:00Z",
          author: "bob",
        },
        {
          patch: [
            {
              op: "replace",
              path: ["/about", "title"],
              value: "Hello",
            },
          ],
          createdAt: "2025-04-08T09:40:00Z",
          author: "carol",
        },
        {
          patch: [
            {
              op: "replace",
              path: ["/about", "status"],
              value: "draft",
            },
          ],
          createdAt: "2025-04-08T09:45:00Z",
          author: "dan",
        },
        {
          patch: [
            {
              op: "replace",
              path: ["/home", "sections", "0", "heading"],
              value: "Hero Section",
            },
          ],
          createdAt: "2025-04-08T09:50:00Z",
          author: "eve",
        },
      ]}
    />
  ),
};

export const RouterPageUpdated: Story = {
  render: () => (
    <StorySetup
      mockData={routerMockData}
      moduleFilePath={ROUTER_MODULE_FILE_PATH}
      serializedSchema={routerSerializedSchema}
      patches={[
        {
          patch: [
            {
              op: "replace",
              path: ["/home", "title"],
              value: "Welcome Home — Updated",
            },
          ],
          createdAt: "2025-04-10T10:00:00Z",
          author: "alice",
        },
      ]}
    />
  ),
};

export const RouterPageAdded: Story = {
  render: () => (
    <StorySetup
      mockData={routerMockData}
      moduleFilePath={ROUTER_MODULE_FILE_PATH}
      serializedSchema={routerSerializedSchema}
      patches={[
        {
          patch: [
            {
              op: "add",
              path: ["/pricing"],
              value: {
                title: "Pricing",
                body: [
                  { tag: "p", children: ["Check out our pricing plans."] },
                ],
              },
            },
          ],
          createdAt: "2025-04-11T09:00:00Z",
          author: "carol",
        },
      ]}
    />
  ),
};

const ARRAY_MODULE_FILE_PATH = "/app/tags.val.ts" as ModuleFilePath;

const arrayModule = c.define(
  "/app/tags.val.ts",
  s.record(
    s.object({
      tags: s.array(s.string()),
    }),
  ),
  {
    "/page": {
      tags: ["alpha", "beta", "gamma", "delta", "epsilon"],
    },
  },
);

const arrayMockData = createMockData([arrayModule]);
const arraySerializedSchema = arrayMockData.schemas[ARRAY_MODULE_FILE_PATH];

/**
 * Array with 5 items, changes at indices 1 and 3. Should render:
 * [chunk: 1 unchanged] change@1 [chunk: 1 unchanged] change@3 [chunk: 1 unchanged]
 */
export const ArrayMidChange: Story = {
  render: () => (
    <StorySetup
      mockData={arrayMockData}
      moduleFilePath={ARRAY_MODULE_FILE_PATH}
      serializedSchema={arraySerializedSchema}
      patches={[
        {
          patch: [
            {
              op: "replace",
              path: ["/page", "tags", "1"],
              value: "BETA-UPDATED",
            },
          ],
          createdAt: "2025-04-03T08:00:00Z",
          author: "alice",
        },
        {
          patch: [
            {
              op: "replace",
              path: ["/page", "tags", "3"],
              value: "DELTA-UPDATED",
            },
          ],
          createdAt: "2025-04-03T08:05:00Z",
          author: "bob",
        },
      ]}
    />
  ),
};

const UNION_MODULE_FILE_PATH = "/app/features.val.ts" as ModuleFilePath;

const unionModule = c.define(
  "/app/features.val.ts",
  s.record(
    s.object({
      content: s.union(
        "type",
        s.object({
          type: s.literal("test-1"),
          exampleField: s.object({
            title: s.string(),
            description: s.string(),
          }),
        }),
        s.object({
          type: s.literal("test-2"),
          otherField: s.string(),
          count: s.number(),
        }),
      ),
    }),
  ),
  {
    "/entry": {
      content: {
        type: "test-1",
        exampleField: {
          title: "Original title",
          description: "A description for the test-1 variant",
        },
      },
    },
  },
);

const unionMockData = createMockData([unionModule]);
const unionSerializedSchema = unionMockData.schemas[UNION_MODULE_FILE_PATH];

/**
 * Discriminated union variant switch: the `content` field changes from
 * a "test-1" object to a "test-2" object. This is a full object replace
 * (the only valid way to switch variants in a tagged union).
 */
export const UnionVariantSwitch: Story = {
  render: () => (
    <StorySetup
      mockData={unionMockData}
      moduleFilePath={UNION_MODULE_FILE_PATH}
      serializedSchema={unionSerializedSchema}
      patches={[
        {
          patch: [
            {
              op: "replace",
              path: ["/entry", "content"],
              value: {
                type: "test-2",
                otherField: "Switched to test-2 variant",
                count: 42,
              },
            },
          ],
          createdAt: "2025-04-12T11:00:00Z",
          author: "alice",
        },
      ]}
    />
  ),
};

/**
 * Exercises the "unchanged value" detection: the title replace uses the
 * *same* value as the original source (`"Welcome Home"`), so the before/after
 * are identical. The status replace is a real change for contrast.
 * The title row should appear dimmed with an "Unchanged" badge and a direct
 * Discard button (no confirmation popover).
 */
export const UnchangedValue: Story = {
  render: () => (
    <StorySetup
      mockData={mockData}
      moduleFilePath={MODULE_FILE_PATH}
      serializedSchema={serializedSchema}
      canDiscard
      patches={[
        {
          patch: [
            {
              op: "replace",
              path: ["/home", "title"],
              value: "Welcome Home",
            },
          ],
          createdAt: "2025-04-03T08:00:00Z",
          author: "alice",
        },
        {
          patch: [
            {
              op: "replace",
              path: ["/home", "status"],
              value: "published",
            },
          ],
          createdAt: "2025-04-03T08:05:00Z",
          author: "alice",
        },
      ]}
    />
  ),
};

/**
 * Edited, then edited back — the whole chain amounts to nothing.
 *
 * `/home`'s title is changed and changed again to what it already was, so the
 * module's patched source is deep-equal to the server's. The list itself should
 * be empty: what shows is the notice saying so, with Discard beside it (the
 * only way forward, since Publish is disabled in this state), and the module
 * folded away under History.
 *
 * Contrast `UnchangedValue`, where one field returns to its original but a
 * second field really changes — that module still ships, so it stays in the
 * list with the unchanged row marked inside it.
 */
export const EverythingReverted: Story = {
  render: () => (
    <StorySetup
      mockData={mockData}
      moduleFilePath={MODULE_FILE_PATH}
      serializedSchema={serializedSchema}
      canDiscard
      patches={[
        {
          patch: [
            {
              op: "replace",
              path: ["/home", "title"],
              value: "Welcome Home — Updated",
            },
          ],
          createdAt: "2025-04-03T08:00:00Z",
          author: "alice",
        },
        {
          patch: [
            {
              op: "replace",
              path: ["/home", "title"],
              value: "Welcome Home",
            },
          ],
          createdAt: "2025-04-03T08:05:00Z",
          author: "alice",
        },
      ]}
    />
  ),
};

export const NoChanges: Story = {
  render: () => (
    <StorySetup
      mockData={mockData}
      moduleFilePath={MODULE_FILE_PATH}
      serializedSchema={serializedSchema}
      patches={[]}
    />
  ),
};

// --- Images (media record) stories ---

const IMAGES_MODULE_FILE_PATH = "/content/images.val.ts" as ModuleFilePath;

/**
 * The refs point at the sample images Storybook serves out of `public/`, so
 * the thumbnails in these stories are real pixels: `refToUrl` strips the
 * leading `/public`, which turns `/public/sample-image-1.jpg` into the
 * `/sample-image-1.jpg` the dev server and the static build both hand out.
 * Dimensions below match the actual files.
 */
const imagesModule = c.define(
  "/content/images.val.ts",
  s.images({
    accept: "image/jpeg",
    directory: "/public",
  }),
  {
    "/public/sample-image-3.jpg": {
      width: 1200,
      height: 800,
      mimeType: "image/jpeg",
      alt: "Hero banner",
      hotspot: { x: 0.5, y: 0.3 },
    },
    "/public/sample-image-2.jpg": {
      width: 600,
      height: 800,
      mimeType: "image/jpeg",
      alt: "Company logo",
    },
  },
);

const imagesMockData = createMockData([imagesModule]);
const imagesSerializedSchema = imagesMockData.schemas[IMAGES_MODULE_FILE_PATH];

/**
 * An image added to a media record. Shows the image thumbnail with a green
 * "Added" rail alongside the metadata (filename, dimensions, mimeType, alt).
 */
export const ImageAdded: Story = {
  render: () => (
    <StorySetup
      mockData={imagesMockData}
      moduleFilePath={IMAGES_MODULE_FILE_PATH}
      serializedSchema={imagesSerializedSchema}
      patches={[
        {
          patch: [
            {
              op: "add",
              path: ["/public/sample-image-1.jpg"],
              value: {
                width: 800,
                height: 600,
                mimeType: "image/jpeg",
                alt: "A sunset over the mountains",
              },
            },
          ],
          createdAt: "2025-04-15T10:00:00Z",
          author: "alice",
        },
      ]}
    />
  ),
};

/**
 * An image removed from a media record. Shows the image thumbnail with a red
 * "Removed" rail (faded) alongside the metadata that was present before.
 */
export const ImageRemoved: Story = {
  render: () => (
    <StorySetup
      mockData={imagesMockData}
      moduleFilePath={IMAGES_MODULE_FILE_PATH}
      serializedSchema={imagesSerializedSchema}
      patches={[
        {
          patch: [
            {
              op: "remove",
              path: ["/public/sample-image-2.jpg"],
            },
          ],
          createdAt: "2025-04-15T11:00:00Z",
          author: "bob",
        },
      ]}
    />
  ),
};

/**
 * A metadata-only change on an image (alt text updated). Shows the image as
 * context with a side-by-side Before / After metadata diff labeled "Metadata".
 */
export const ImageAltTextChanged: Story = {
  render: () => (
    <StorySetup
      mockData={imagesMockData}
      moduleFilePath={IMAGES_MODULE_FILE_PATH}
      serializedSchema={imagesSerializedSchema}
      patches={[
        {
          patch: [
            {
              op: "replace",
              path: ["/public/sample-image-3.jpg", "alt"],
              value: "Updated hero banner — redesigned",
            },
          ],
          createdAt: "2025-04-15T12:00:00Z",
          author: "carol",
        },
      ]}
    />
  ),
};

/**
 * A hotspot change on an image. The hotspot dot and coordinates are shown
 * below the thumbnail.
 */
export const ImageHotspotChanged: Story = {
  render: () => (
    <StorySetup
      mockData={imagesMockData}
      moduleFilePath={IMAGES_MODULE_FILE_PATH}
      serializedSchema={imagesSerializedSchema}
      patches={[
        {
          patch: [
            {
              op: "replace",
              path: ["/public/sample-image-3.jpg", "hotspot"],
              value: { x: 0.8, y: 0.6 },
            },
          ],
          createdAt: "2025-04-15T13:00:00Z",
          author: "alice",
        },
      ]}
    />
  ),
};

/**
 * An image added with a hotspot. Shows the hotspot dot on the thumbnail
 * and the coordinates below.
 */
export const ImageAddedWithHotspot: Story = {
  render: () => (
    <StorySetup
      mockData={imagesMockData}
      moduleFilePath={IMAGES_MODULE_FILE_PATH}
      serializedSchema={imagesSerializedSchema}
      patches={[
        {
          patch: [
            {
              op: "add",
              path: ["/public/sample-image-1.jpg"],
              value: {
                width: 800,
                height: 600,
                mimeType: "image/jpeg",
                alt: "A sunset over the mountains",
                hotspot: { x: 0.65, y: 0.4 },
              },
            },
          ],
          createdAt: "2025-04-15T14:00:00Z",
          author: "bob",
        },
      ]}
    />
  ),
};

/**
 * Mixed media record changes: one image added, one removed, and one with
 * a metadata-only edit (alt text). Exercises all three media diff modes
 * together in one module.
 */
export const ImageMixedChanges: Story = {
  render: () => (
    <StorySetup
      mockData={imagesMockData}
      moduleFilePath={IMAGES_MODULE_FILE_PATH}
      serializedSchema={imagesSerializedSchema}
      patches={[
        {
          patch: [
            {
              op: "add",
              path: ["/public/sample-image-1.jpg"],
              value: {
                width: 800,
                height: 600,
                mimeType: "image/jpeg",
                alt: "A sunset over the mountains",
              },
            },
          ],
          createdAt: "2025-04-15T10:00:00Z",
          author: "alice",
        },
        {
          patch: [
            {
              op: "remove",
              path: ["/public/sample-image-2.jpg"],
            },
          ],
          createdAt: "2025-04-15T11:00:00Z",
          author: "bob",
        },
        {
          patch: [
            {
              op: "replace",
              path: ["/public/sample-image-3.jpg", "alt"],
              value: "Updated hero banner — redesigned",
            },
          ],
          createdAt: "2025-04-15T12:00:00Z",
          author: "carol",
        },
      ]}
    />
  ),
};

// #region staging stories

/**
 * Stage / unstage, with nothing held back.
 *
 * This is the default state and it is deliberately indistinguishable in effect
 * from the old all-or-nothing review screen: every row reads "Staged", so Publish
 * publishes everything. Staging is opt-in.
 */
export const StagingNothingHeld: Story = {
  render: () => (
    <StorySetup
      mockData={mockData}
      moduleFilePath={MODULE_FILE_PATH}
      serializedSchema={mockData.schemas[MODULE_FILE_PATH]}
      staging
      patches={[
        {
          patch: [
            { op: "replace", path: ["/home", "title"], value: "Welcome!" },
          ],
          createdAt: "2025-04-15T10:00:00Z",
          author: "alice",
        },
        {
          patch: [
            {
              op: "replace",
              path: ["/about", "title"],
              value: "About our team",
            },
          ],
          createdAt: "2025-04-15T11:00:00Z",
          author: "bob",
        },
      ]}
    />
  ),
};

/**
 * The headline case: ship one change and hold another back.
 *
 * Alice's title fix is staged; Bob's is held. The held row stays visible and
 * re-stageable — if unstaging hid the change there would be no way to find it
 * again and put it back. Hover either control to see what the toggle would move.
 */
export const StagingOneHeld: Story = {
  render: () => (
    <StorySetup
      mockData={mockData}
      moduleFilePath={MODULE_FILE_PATH}
      serializedSchema={mockData.schemas[MODULE_FILE_PATH]}
      staging
      initiallyHeld={[1]}
      patches={[
        {
          patch: [
            { op: "replace", path: ["/home", "title"], value: "Welcome!" },
          ],
          createdAt: "2025-04-15T10:00:00Z",
          author: "alice",
        },
        {
          patch: [
            {
              op: "replace",
              path: ["/about", "title"],
              value: "Work in progress, do not ship",
            },
          ],
          createdAt: "2025-04-15T11:00:00Z",
          author: "bob",
        },
      ]}
    />
  ),
};

/**
 * Two changes to the same array, which therefore cannot be published separately.
 *
 * Both patches land in one patch set, so toggling either one moves both. The
 * tooltip says so, and names the other author — quietly enlarging or shrinking
 * somebody's publish is the failure this control exists to prevent.
 */
export const StagingEntangledArray: Story = {
  render: () => (
    <StorySetup
      mockData={mockData}
      moduleFilePath={MODULE_FILE_PATH}
      serializedSchema={mockData.schemas[MODULE_FILE_PATH]}
      staging
      patches={[
        {
          patch: [
            {
              op: "replace",
              path: ["/home", "sections", "0", "heading"],
              value: "Hero — revised",
            },
          ],
          createdAt: "2025-04-15T10:00:00Z",
          author: "alice",
        },
        {
          patch: [
            {
              op: "add",
              path: ["/home", "sections", "2"],
              value: {
                heading: "Contact",
                items: [{ type: "text", content: "Say hello." }],
              },
            },
          ],
          createdAt: "2025-04-15T11:00:00Z",
          author: "bob",
        },
      ]}
    />
  ),
};

/**
 * Staging off — FS mode, or a content API without patch group support.
 *
 * No toggles, no held summary. The same component, so there is one review screen
 * rather than two.
 */
export const StagingDisabled: Story = {
  render: () => (
    <StorySetup
      mockData={mockData}
      moduleFilePath={MODULE_FILE_PATH}
      serializedSchema={mockData.schemas[MODULE_FILE_PATH]}
      patches={[
        {
          patch: [
            { op: "replace", path: ["/home", "title"], value: "Welcome!" },
          ],
          createdAt: "2025-04-15T10:00:00Z",
          author: "alice",
        },
      ]}
    />
  ),
};

// #endregion

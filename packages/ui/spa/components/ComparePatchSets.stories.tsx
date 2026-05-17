import type { Meta, StoryObj } from "@storybook/react";
import {
  initVal,
  Internal,
  Json,
  ModuleFilePath,
  PatchId,
  ReifiedRender,
  SerializedSchema,
} from "@valbuild/core";
import { ValClient } from "@valbuild/shared/internal";
import { JSONValue } from "@valbuild/core/patch";
import { Patch } from "@valbuild/core/patch";
import { useMemo, useState } from "react";
import { ComparePatchSets } from "./ComparePatchSets";
import { Profile } from "./ValProvider";
import { PatchSets, SerializedPatchSet } from "../utils/PatchSets";
import { ValSyncEngine } from "../ValSyncEngine";
import { ValThemeProvider, Themes } from "./ValThemeProvider";
import { ValErrorProvider } from "./ValErrorProvider";
import { ValPortalProvider } from "./ValPortalProvider";
import { ValFieldProvider } from "./ValFieldProvider";
import { ValRouter } from "./ValRouter";
import { ValRemoteProvider } from "./ValRemoteProvider";
import { TooltipProvider } from "./designSystem/tooltip";

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
  const renders: Record<string, ReifiedRender> = {};

  for (const module of modules) {
    const moduleFilePath = Internal.getValPath(module);
    const schema = Internal.getSchema(module);
    const source = Internal.getSource(module);

    if (moduleFilePath && schema && source !== undefined) {
      const path = moduleFilePath as unknown as ModuleFilePath;
      schemas[path] = schema["executeSerialize"]();
      sources[path] = source;
      renders[path] = schema["executeRender"](path, source);
    }
  }
  return {
    schemas: schemas as Record<ModuleFilePath, SerializedSchema>,
    sources: sources as Record<ModuleFilePath, Json>,
    renders: renders as Record<ModuleFilePath, ReifiedRender>,
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
  engine: ValSyncEngine,
  moduleFilePath: ModuleFilePath,
  serializedSchema: SerializedSchema,
  patches: TestPatch[],
): SerializedPatchSet {
  const patchSets = new PatchSets();
  let now = Date.now();
  for (const p of patches) {
    const result = engine.addPatch(
      moduleFilePath,
      serializedSchema.type,
      p.patch,
      now++,
    );
    const realPatchId =
      "patchId" in result ? result.patchId : (`fallback-${now}` as PatchId);
    for (const op of p.patch) {
      patchSets.insert(
        moduleFilePath,
        serializedSchema,
        op,
        realPatchId,
        p.createdAt,
        p.author,
      );
    }
  }
  return patchSets.serialize();
}

// --- StoryProviders ---

type MockData = {
  schemas: Record<ModuleFilePath, SerializedSchema>;
  sources: Record<ModuleFilePath, Json>;
  renders: Record<ModuleFilePath, ReifiedRender>;
};

function makeEngine(client: ValClient, mockData: MockData): ValSyncEngine {
  const engine = new ValSyncEngine(client, undefined);
  engine.setSchemas(mockData.schemas);
  engine.setSources(
    mockData.sources as Record<ModuleFilePath, JSONValue | undefined>,
  );
  engine.setRenders(mockData.renders);
  engine.setBaseSha("storybook-mock-sha");
  engine.setInitializedAt(Date.now());
  return engine;
}

function StoryProviders({
  children,
  syncEngine,
}: {
  children: React.ReactNode;
  syncEngine: ValSyncEngine;
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
    <ValThemeProvider theme={theme} setTheme={setTheme} config={undefined}>
      <TooltipProvider>
        <ValRouter>
          <ValErrorProvider syncEngine={syncEngine}>
            <ValPortalProvider>
              <ValFieldProvider
                syncEngine={syncEngine}
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
  readonly,
}: {
  mockData: MockData;
  patches: TestPatch[];
  moduleFilePath: ModuleFilePath;
  serializedSchema: SerializedSchema;
  readonly?: boolean;
}) {
  const client = useMemo(() => createMockClient(), []);
  const { engine, patchSets } = useMemo(() => {
    const engine = makeEngine(client, mockData);
    const patchSets = applyPatchesAndSerialize(
      engine,
      moduleFilePath,
      serializedSchema,
      patches,
    );
    return { engine, patchSets };
  }, [client, mockData, moduleFilePath, serializedSchema, patches]);
  return (
    <StoryProviders syncEngine={engine}>
      <ComparePatchSets
        patchSets={patchSets}
        profilesByAuthorIds={mockProfiles}
        readonly={readonly}
      />
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
    avatar: { url: "https://i.pravatar.cc/150?u=bob" },
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
      readonly={false}
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

/**
 * Exercises hidden chunks: changes to /home's `title` and `status` with
 * `body` and `sections` unchanged. Should render a "1 unchanged field hidden"
 * chunk between title and status, and another chunk after status.
 */
export const WithHiddenChunks: Story = {
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
      readonly={false}
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

const imagesModule = c.define(
  "/content/images.val.ts",
  s.images({
    accept: "image/webp",
    directory: "/public/val/images",
  }),
  {
    "/public/val/images/hero-abc123.webp": {
      width: 1920,
      height: 1080,
      mimeType: "image/webp",
      alt: "Hero banner",
      hotspot: { x: 0.5, y: 0.3 },
    },
    "/public/val/images/logo-def456.webp": {
      width: 200,
      height: 200,
      mimeType: "image/webp",
      alt: "Company logo",
    },
  },
);

const imagesMockData = createMockData([imagesModule]);
const imagesSerializedSchema =
  imagesMockData.schemas[IMAGES_MODULE_FILE_PATH];

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
              path: ["/public/val/images/sunset-ghi789.webp"],
              value: {
                width: 800,
                height: 600,
                mimeType: "image/webp",
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
              path: ["/public/val/images/logo-def456.webp"],
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
              path: ["/public/val/images/hero-abc123.webp", "alt"],
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
              path: ["/public/val/images/hero-abc123.webp", "hotspot"],
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
              path: ["/public/val/images/sunset-ghi789.webp"],
              value: {
                width: 800,
                height: 600,
                mimeType: "image/webp",
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
              path: ["/public/val/images/sunset-ghi789.webp"],
              value: {
                width: 800,
                height: 600,
                mimeType: "image/webp",
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
              path: ["/public/val/images/logo-def456.webp"],
            },
          ],
          createdAt: "2025-04-15T11:00:00Z",
          author: "bob",
        },
        {
          patch: [
            {
              op: "replace",
              path: ["/public/val/images/hero-abc123.webp", "alt"],
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

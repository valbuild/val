import type { Meta, StoryObj } from "@storybook/react";
import {
  initVal,
  Internal,
  Json,
  ModuleFilePath,
  ReifiedPreview,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { ValClient } from "@valbuild/shared/internal";
import { useMemo, useState } from "react";
import { BlockList } from "./BlockList";
import { createStorySystem } from "../stores/react/storySystem";
import { ValSystemProvider } from "../stores/react/SystemContext";
import { ValThemeProvider, Themes } from "./ValThemeProvider";
import { ValErrorProvider } from "./ValErrorProvider";
import { ValPortalProvider } from "./ValPortalProvider";
import { ValFieldProvider } from "./ValFieldProvider";
import { ValRemoteProvider } from "./ValRemoteProvider";
import { ValRouter } from "./ValRouter";
import { TooltipProvider } from "./designSystem/tooltip";

// Same story harness as InlineField.stories.tsx: real modules built with
// initVal, serialized/previewed the same way the app does it.

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
      return Promise.resolve({ status: 200, json: { newPatchIds } });
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

function StoryProviders({
  children,
  mockData,
}: {
  children: React.ReactNode;
  mockData: ReturnType<typeof createMockData>;
}) {
  const client = useMemo(() => createMockClient(), []);
  const [theme, setTheme] = useState<Themes | null>("dark");
  const system = useMemo(() => {
    return createStorySystem({
      schemas: mockData.schemas,
      sources: mockData.sources,
      previews: mockData.previews,
    });
  }, [client, mockData]);
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
                  <ValRemoteProvider remoteFiles={{ status: "not-asked" }}>
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

// --- Fixtures ---

const { s, c } = initVal();

/**
 * The motivating page-builder shape from the feature request, one level
 * deeper: pages > sections > links are all sortable lists of inline objects,
 * so three list levels have to fit on a laptop.
 */
const pagesModule = c.define(
  "/content/pages.val.ts",
  s.object({
    blocks: s
      .array(
        s.object({
          title: s.string(),
          subtitle: s
            .string()
            .multiline()
            .describe("One line under the title. Keep it short."),
          sections: s
            .array(
              s.object({
                title: s.string(),
                content: s.richtext(),
                links: s
                  .array(
                    s.object({
                      label: s.string(),
                      url: s.string(),
                    }),
                  )
                  .render({ as: "inline" }),
              }),
            )
            .render({ as: "inline" }),
        }),
      )
      .render({ as: "inline" }),
  }),
  {
    blocks: [
      {
        title: "Welcome to Val",
        subtitle: "A CMS where your content is code.",
        sections: [
          {
            title: "Why Val?",
            content: [
              {
                tag: "p",
                children: ["Content lives in git, typed end to end."],
              },
            ],
            links: [
              { label: "Docs", url: "https://val.build/docs" },
              { label: "GitHub", url: "https://github.com/valbuild" },
            ],
          },
          {
            title: "Getting started",
            content: [{ tag: "p", children: ["Run npm create @valbuild."] }],
            links: [{ label: "Quickstart", url: "https://val.build/start" }],
          },
        ],
      },
      {
        title: "Pricing",
        subtitle: "Free while in beta.",
        sections: [
          {
            title: "Plans",
            content: [{ tag: "p", children: ["One plan: all of it."] }],
            links: [],
          },
        ],
      },
    ],
  },
);

const tagsModule = c.define(
  "/content/tags.val.ts",
  s.object({
    tags: s.array(s.string()).render({ as: "inline" }),
  }),
  { tags: ["design", "engineering", "content"] },
);

/** A list WITHOUT `.render({ as: "inline" })`: rows stay clickable previews. */
const previewRowsModule = c.define(
  "/content/testimonials.val.ts",
  s.object({
    testimonials: s.array(
      s
        .object({
          quote: s.string(),
          name: s.string(),
        })
        .preview(({ val }) => ({ title: val.name, subtitle: val.quote })),
    ),
  }),
  {
    testimonials: [
      { quote: "Val changed how we ship content.", name: "Ada Lovelace" },
      { quote: "The type-safety is the point.", name: "Grace Hopper" },
    ],
  },
);

const authorsModule = c.define(
  "/content/authors.val.ts",
  s.record(
    s.object({
      name: s.string(),
      birthdate: s.date(),
      bio: s.string().multiline(),
    }),
  ),
  {
    fredrik: {
      name: "Fredrik Ekholdt",
      birthdate: "1980-01-01",
      bio: "Building Val.",
    },
    erlend: {
      name: "Erlend Hamberg",
      birthdate: "1985-06-15",
      bio: "Also building Val.",
    },
  },
);

/** An inlined keyOf shows the CONTENT of the referenced entry inside the row. */
const articlesModule = c.define(
  "/content/articles.val.ts",
  s.object({
    articles: s
      .array(
        s.object({
          title: s.string(),
          author: s.keyOf(authorsModule).render({ as: "inline" }),
        }),
      )
      .render({ as: "inline" }),
  }),
  {
    articles: [
      { title: "Inline rendering deep dive", author: "fredrik" },
      { title: "Sortable lists from scratch", author: "erlend" },
    ],
  },
);

/**
 * A tagged union of blocks, with the render on the LIST — how a page builder
 * is written. One variant declares a preview as well: it titles the row's
 * header, and does not take the editor away.
 */
const sectionsModule = c.define(
  "/content/sections.val.ts",
  s.object({
    sections: s
      .array(
        s.discriminatedUnion(
          "type",
          s.object({
            type: s.literal("text"),
            text: s.richtext(),
          }),
          s
            .object({
              type: s.literal("code"),
              code: s.code({ language: "typescript" }),
            })
            .preview(({ val }) => ({ title: val.code })),
        ),
      )
      .render({ as: "inline" }),
  }),
  {
    sections: [
      {
        type: "text",
        text: [{ tag: "p", children: ["A paragraph of body copy."] }],
      },
      { type: "code", code: 'console.log("and a code block");' },
    ],
  },
);

/**
 * An inline RECORD: the same rows as an inline array, named by their key
 * instead of numbered, with no grip (a record has no order). One entry holds
 * an inline array, so both kinds of list nest in one view.
 */
const teamModule = c.define(
  "/content/team.val.ts",
  s.object({
    members: s
      .record(
        s.object({
          name: s.string(),
          birthdate: s.date(),
          bio: s.string().multiline(),
          links: s
            .array(s.object({ label: s.string(), url: s.string() }))
            .render({ as: "inline" }),
        }),
      )
      .render({ as: "inline" }),
  }),
  {
    members: {
      fredrik: {
        name: "Fredrik Ekholdt",
        birthdate: "1980-01-01",
        bio: "Building Val.",
        links: [{ label: "GitHub", url: "https://github.com/freekh" }],
      },
      erlend: {
        name: "Erlend Hamberg",
        birthdate: "1985-06-15",
        bio: "Also building Val.",
        links: [],
      },
    },
  },
);

/** An inline record of strings: one line per entry, key then value. */
const labelsModule = c.define(
  "/content/labels.val.ts",
  s.object({
    labels: s.record(s.string()).render({ as: "inline" }),
  }),
  { labels: { save: "Save", cancel: "Cancel", delete: "Delete" } },
);

/** An inline record nested in an inline array's item. */
const productsModule = c.define(
  "/content/products.val.ts",
  s.object({
    products: s
      .array(
        s.object({
          title: s.string(),
          specs: s.record(s.string()).render({ as: "inline" }),
        }),
      )
      .render({ as: "inline" }),
  }),
  {
    products: [
      {
        title: "Kettle",
        specs: { volume: "1.7 l", power: "2200 W" },
      },
      { title: "Toaster", specs: { slots: "2" } },
    ],
  },
);

/** A long list: moving by number has to work without scrolling a grid. */
const manyModule = c.define(
  "/content/many.val.ts",
  s.object({
    items: s.array(s.string()).render({ as: "inline" }),
  }),
  { items: Array.from({ length: 60 }, (_, i) => `Item ${i + 1}`) },
);

const pagesData = createMockData([pagesModule]);
const manyData = createMockData([manyModule]);
const teamData = createMockData([teamModule]);
const labelsData = createMockData([labelsModule]);
const productsData = createMockData([productsModule]);
const sectionsData = createMockData([sectionsModule]);
const tagsData = createMockData([tagsModule]);
const previewRowsData = createMockData([previewRowsModule]);
const articlesData = createMockData([articlesModule, authorsModule]);

// --- Storybook meta ---

const meta: Meta = {
  title: "Components/BlockList",
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="p-6 bg-bg-primary min-h-[200px] max-w-2xl">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj;

function sourcePathOf(moduleFilePath: string, key: string): SourcePath {
  return `${moduleFilePath}?p=${JSON.stringify(key)}` as SourcePath;
}

export const ThreeLevels: Story = {
  name: "Three levels (page builder)",
  render: () => (
    <StoryProviders mockData={pagesData}>
      <BlockList path={sourcePathOf("/content/pages.val.ts", "blocks")} />
    </StoryProviders>
  ),
};

export const UnionBlocks: Story = {
  name: "Union blocks (render on the list)",
  render: () => (
    <StoryProviders mockData={sectionsData}>
      <BlockList path={sourcePathOf("/content/sections.val.ts", "sections")} />
    </StoryProviders>
  ),
};

export const InlineStrings: Story = {
  name: "Inline strings",
  render: () => (
    <StoryProviders mockData={tagsData}>
      <BlockList path={sourcePathOf("/content/tags.val.ts", "tags")} />
    </StoryProviders>
  ),
};

export const PreviewRows: Story = {
  name: "Preview rows (not inline)",
  render: () => (
    <StoryProviders mockData={previewRowsData}>
      <BlockList
        path={sourcePathOf("/content/testimonials.val.ts", "testimonials")}
      />
    </StoryProviders>
  ),
};

export const InlineKeyOf: Story = {
  name: "Inline keyOf (referenced content)",
  render: () => (
    <StoryProviders mockData={articlesData}>
      <BlockList path={sourcePathOf("/content/articles.val.ts", "articles")} />
    </StoryProviders>
  ),
};

export const InlineRecord: Story = {
  name: "Inline record",
  render: () => (
    <StoryProviders mockData={teamData}>
      <BlockList path={sourcePathOf("/content/team.val.ts", "members")} />
    </StoryProviders>
  ),
};

export const InlineRecordOfStrings: Story = {
  name: "Inline record of strings",
  render: () => (
    <StoryProviders mockData={labelsData}>
      <BlockList path={sourcePathOf("/content/labels.val.ts", "labels")} />
    </StoryProviders>
  ),
};

export const RecordInArray: Story = {
  name: "Inline record in an inline array",
  render: () => (
    <StoryProviders mockData={productsData}>
      <BlockList path={sourcePathOf("/content/products.val.ts", "products")} />
    </StoryProviders>
  ),
};

export const ManyItems: Story = {
  name: "Many items (60)",
  render: () => (
    <StoryProviders mockData={manyData}>
      <BlockList path={sourcePathOf("/content/many.val.ts", "items")} />
    </StoryProviders>
  ),
};

export const Readonly: Story = {
  name: "Readonly",
  render: () => (
    <StoryProviders mockData={pagesData}>
      <BlockList
        path={sourcePathOf("/content/pages.val.ts", "blocks")}
        readonly
      />
    </StoryProviders>
  ),
};

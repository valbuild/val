import type { Meta, StoryObj } from "@storybook/react";
import { RichTextEditor, useRichTextEditor } from "./RichTextEditor";
import {
  RichTextSource,
  AllRichTextOptions,
  ModuleFilePath,
  SerializedSchema,
  ReifiedRender,
  initVal,
  Internal,
  Json,
} from "@valbuild/core";
import { richTextToRemirror } from "@valbuild/shared/internal";
import { ValPortalProvider } from "./ValPortalProvider";
import { Themes, ValThemeProvider } from "./ValThemeProvider";
import { useMemo, useState } from "react";
import { ValFieldProvider } from "./ValFieldProvider";
import { ValSyncEngine } from "../ValSyncEngine";
import { ValClient } from "@valbuild/shared/internal";
import { JSONValue } from "@valbuild/core/patch";

// Create mock data with routes for testing
function createMockData() {
  const { s, c } = initVal();

  // Create a simple mock router for Storybook
  const mockRouter = {
    getRouterId: () => "next-app-router",
    validate: () => [],
  };

  // Router module for blog pages
  const blogPages = c.define(
    "/app/blogs/[blog]/page.val.ts",
    s
      .record(
        s.object({
          title: s.string(),
          content: s.richtext(),
        }),
      )
      .router(mockRouter),
    {
      "/blogs/getting-started": {
        title: "Getting Started with Val",
        content: [],
      },
      "/blogs/advanced-features": {
        title: "Advanced Features",
        content: [],
      },
      "/blogs/best-practices": {
        title: "Best Practices",
        content: [],
      },
    },
  );

  // Router module for docs pages
  const docsPages = c.define(
    "/app/docs/[...slug]/page.val.ts",
    s
      .record(
        s.object({
          title: s.string(),
          content: s.richtext(),
        }),
      )
      .router(mockRouter),
    {
      "/docs/introduction": {
        title: "Introduction",
        content: [],
      },
      "/docs/installation": {
        title: "Installation",
        content: [],
      },
      "/docs/api-reference": {
        title: "API Reference",
        content: [],
      },
    },
  );

  // Extract schemas and sources from the modules
  const modules = [blogPages, docsPages];
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

// Create a minimal mock ValClient for Storybook
function createMockClient(mockData: {
  schemas: Record<ModuleFilePath, SerializedSchema>;
  sources: Record<ModuleFilePath, Json>;
}): ValClient {
  return (async () => {
    return {
      status: 200,
      json: async () => ({
        schemas: mockData.schemas,
        sources: mockData.sources,
        config: { project: "storybook-test" },
      }),
    } as unknown as Awaited<ReturnType<ValClient>>;
  }) as ValClient;
}

// Wrapper component that uses the hook
function RichTextEditorStory({
  content,
  options,
}: {
  content?: RichTextSource<AllRichTextOptions>;
  options?: {
    style?: {
      bold?: boolean;
      italic?: boolean;
      lineThrough?: boolean;
    };
    inline?: {
      a?: boolean;
      img?: boolean;
    };
    block?: {
      h1?: boolean;
      h2?: boolean;
      h3?: boolean;
      h4?: boolean;
      h5?: boolean;
      h6?: boolean;
      ul?: boolean;
      ol?: boolean;
    };
  };
}) {
  const initialContent = content ? richTextToRemirror(content) : undefined;
  const { manager, state, setState } = useRichTextEditor(initialContent);
  const [theme, setTheme] = useState<Themes | null>("dark");

  // Create mock data and sync engine if routes are needed
  const mockData = useMemo(() => createMockData(), []);
  const client = useMemo(() => createMockClient(mockData), [mockData]);
  const syncEngine = useMemo(() => {
    const engine = new ValSyncEngine(client, undefined);
    engine.setSchemas(mockData.schemas);
    engine.setSources(
      mockData.sources as Record<ModuleFilePath, JSONValue | undefined>,
    );
    engine.setRenders(mockData.renders);
    engine.setInitializedAt(Date.now());
    return engine;
  }, [client, mockData]);

  const getDirectFileUploadSettings = useMemo(
    () => async () => {
      return {
        status: "success" as const,
        data: {
          nonce: null,
          baseUrl: "https://mock-upload.example.com",
        },
      };
    },
    [],
  );

  const editor = (
    <div className="w-full max-w-2xl">
      <RichTextEditor
        manager={manager}
        state={state}
        onChange={(params) => {
          setState(params.state);
        }}
        options={options}
        autoFocus={false}
      />
    </div>
  );

  return (
    <ValThemeProvider
      theme={theme}
      setTheme={setTheme}
      config={{
        project: "storybook-test",
      }}
    >
      <ValPortalProvider>
        <ValFieldProvider
          syncEngine={syncEngine}
          getDirectFileUploadSettings={getDirectFileUploadSettings}
          config={undefined}
        >
          {editor}
        </ValFieldProvider>
      </ValPortalProvider>
    </ValThemeProvider>
  );
}

const meta: Meta<typeof RichTextEditorStory> = {
  title: "Components/RichTextEditor",
  component: RichTextEditorStory,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="min-h-[300px] w-full p-8 bg-bg-primary text-fg-primary">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof RichTextEditorStory>;

// Empty editor
export const Empty: Story = {
  args: {
    content: [],
    options: {
      style: {
        bold: true,
        italic: true,
        lineThrough: true,
      },
      inline: {
        a: true,
        img: true,
      },
      block: {
        h1: true,
        h2: true,
        h3: true,
        h4: true,
        h5: true,
        h6: true,
        ul: true,
        ol: true,
      },
    },
  },
  name: "Empty",
};

// Editor with links (both external and route links)
export const WithLink: Story = {
  args: {
    content: [
      {
        tag: "p",
        children: [
          "This is a paragraph with an ",
          {
            tag: "a",
            href: "https://val.build",
            children: ["external link"],
          },
          " and a ",
          {
            tag: "a",
            href: "/blogs/getting-started",
            children: ["route link"],
          },
          " in the middle.",
        ],
      },
      {
        tag: "p",
        children: [
          "Here are more examples: ",
          {
            tag: "a",
            href: "/blogs/advanced-features",
            children: ["Advanced Features"],
          },
          ", ",
          {
            tag: "a",
            href: "/docs/introduction",
            children: ["Introduction"],
          },
          ", and ",
          {
            tag: "a",
            href: "/docs/api-reference",
            children: ["API Reference"],
          },
          ".",
        ],
      },
    ],
    options: {
      style: {
        bold: true,
        italic: true,
        lineThrough: true,
      },
      inline: {
        a: true,
        img: true,
      },
      block: {
        h1: true,
        h2: true,
        h3: true,
        ul: true,
        ol: true,
      },
    },
  },
  name: "With Link",
};

// Editor with a list
export const WithBulletList: Story = {
  args: {
    content: [
      {
        tag: "p",
        children: ["Here's a bullet list:"],
      },
      {
        tag: "ul",
        children: [
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: ["First item"],
              },
            ],
          },
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: ["Second item"],
              },
            ],
          },
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: ["Third item"],
              },
            ],
          },
        ],
      },
    ],
    options: {
      style: {
        bold: true,
        italic: true,
        lineThrough: true,
      },
      inline: {
        a: true,
        img: true,
      },
      block: {
        h1: true,
        h2: true,
        h3: true,
        ul: true,
        ol: true,
      },
    },
  },
  name: "With Bullet List",
};

// Editor with an ordered list
export const WithOrderedList: Story = {
  args: {
    content: [
      {
        tag: "p",
        children: ["Here's an ordered list:"],
      },
      {
        tag: "ol",
        children: [
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: ["First step"],
              },
            ],
          },
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: ["Second step"],
              },
            ],
          },
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: ["Third step"],
              },
            ],
          },
        ],
      },
    ],
    options: {
      style: {
        bold: true,
        italic: true,
        lineThrough: true,
      },
      inline: {
        a: true,
        img: true,
      },
      block: {
        h1: true,
        h2: true,
        h3: true,
        ul: true,
        ol: true,
      },
    },
  },
  name: "With Ordered List",
};

// Editor with text formatting (bold, italic, strikethrough)
export const WithFormatting: Story = {
  args: {
    content: [
      {
        tag: "p",
        children: [
          "This text is ",
          {
            tag: "span",
            styles: ["bold"],
            children: ["bold"],
          },
          ", this is ",
          {
            tag: "span",
            styles: ["italic"],
            children: ["italic"],
          },
          ", and this is ",
          {
            tag: "span",
            styles: ["line-through"],
            children: ["strikethrough"],
          },
          ".",
        ],
      },
      {
        tag: "p",
        children: [
          "You can also combine them: ",
          {
            tag: "span",
            styles: ["bold", "italic"],
            children: ["bold and italic"],
          },
          ".",
        ],
      },
    ],
    options: {
      style: {
        bold: true,
        italic: true,
        lineThrough: true,
      },
      inline: {
        a: true,
        img: true,
      },
      block: {
        h1: true,
        h2: true,
        h3: true,
        ul: true,
        ol: true,
      },
    },
  },
  name: "With Formatting",
};

// Comprehensive example with multiple features
export const Comprehensive: Story = {
  args: {
    content: [
      {
        tag: "h1",
        children: ["Rich Text Editor Demo"],
      },
      {
        tag: "p",
        children: [
          "This editor supports ",
          {
            tag: "span",
            styles: ["bold"],
            children: ["bold"],
          },
          ", ",
          {
            tag: "span",
            styles: ["italic"],
            children: ["italic"],
          },
          ", and ",
          {
            tag: "span",
            styles: ["line-through"],
            children: ["strikethrough"],
          },
          " text formatting.",
        ],
      },
      {
        tag: "h2",
        children: ["Links"],
      },
      {
        tag: "p",
        children: [
          "You can also add ",
          {
            tag: "a",
            href: "https://val.build",
            children: ["hyperlinks"],
          },
          " to your content.",
        ],
      },
      {
        tag: "h2",
        children: ["Lists"],
      },
      {
        tag: "ul",
        children: [
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: ["Bullet lists"],
              },
            ],
          },
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: ["Are"],
              },
            ],
          },
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: ["Supported"],
              },
            ],
          },
        ],
      },
      {
        tag: "ol",
        children: [
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: ["As well as"],
              },
            ],
          },
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: ["Ordered lists"],
              },
            ],
          },
        ],
      },
    ],
    options: {
      style: {
        bold: true,
        italic: true,
        lineThrough: true,
      },
      inline: {
        a: true,
        img: true,
      },
      block: {
        h1: true,
        h2: true,
        h3: true,
        h4: true,
        h5: true,
        h6: true,
        ul: true,
        ol: true,
      },
    },
  },
  name: "Comprehensive Example",
};

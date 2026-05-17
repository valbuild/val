import type { Meta, StoryObj } from "@storybook/react";
import {
  initVal,
  Internal,
  Json,
  ModuleFilePath,
  ReifiedRender,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { ValClient } from "@valbuild/shared/internal";
import { JSONValue } from "@valbuild/core/patch";
import { useMemo, useState } from "react";
import { Field } from "./Field";
import { AnyField } from "./AnyField";
import { ValSyncEngine } from "../ValSyncEngine";
import { ValThemeProvider, Themes } from "./ValThemeProvider";
import { ValErrorProvider } from "./ValErrorProvider";
import { ValPortalProvider } from "./ValPortalProvider";
import { ValFieldProvider } from "./ValFieldProvider";
import { useSchemaAtPath } from "./ValFieldProvider";
import { ValRouter } from "./ValRouter";
import { TooltipProvider } from "./designSystem/tooltip";

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

function StoryProviders({
  children,
  mockData,
}: {
  children: React.ReactNode;
  mockData: {
    schemas: Record<ModuleFilePath, SerializedSchema>;
    sources: Record<ModuleFilePath, Json>;
    renders: Record<ModuleFilePath, ReifiedRender>;
  };
}) {
  const client = useMemo(() => createMockClient(), []);
  const [theme, setTheme] = useState<Themes | null>("dark");
  const syncEngine = useMemo(() => {
    const engine = new ValSyncEngine(client, undefined);
    engine.setSchemas(mockData.schemas);
    engine.setSources(
      mockData.sources as Record<ModuleFilePath, JSONValue | undefined>,
    );
    engine.setRenders(mockData.renders);
    engine.setBaseSha("storybook-mock-sha");
    engine.setInitializedAt(Date.now());
    return engine;
  }, [client, mockData]);

  const getDirectFileUploadSettings = useMemo(
    () => async () => ({
      status: "success" as const,
      data: { nonce: null, baseUrl: "https://mock-upload.example.com" },
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
                {children}
              </ValFieldProvider>
            </ValPortalProvider>
          </ValErrorProvider>
        </ValRouter>
      </TooltipProvider>
    </ValThemeProvider>
  );
}

function InlineFieldRoot({
  moduleFilePath,
  readonly,
}: {
  moduleFilePath: ModuleFilePath;
  readonly: boolean;
}) {
  const schemaAtPath = useSchemaAtPath(moduleFilePath);
  if (schemaAtPath.status !== "success") {
    return <div>Loading...</div>;
  }
  const schema = schemaAtPath.data;
  const path = moduleFilePath as unknown as SourcePath;
  return (
    <Field
      label={moduleFilePath.split("/").pop()?.replace(".val.ts", "")}
      path={path}
      type={schema.type}
      readonly={readonly}
      compact
    >
      <AnyField
        path={path}
        schema={schema}
        readonly={readonly}
        compact
        inline
      />
    </Field>
  );
}

// --- Schemas ---

const { s, c } = initVal();

const nestedObjectModule = c.define(
  "/content/profile.val.ts",
  s.object({
    name: s.string(),
    age: s.number(),
    active: s.boolean(),
    address: s.object({
      street: s.string(),
      city: s.string(),
      zip: s.string(),
    }),
  }),
  {
    name: "Alice Andersen",
    age: 32,
    active: true,
    address: {
      street: "Karl Johans gate 1",
      city: "Oslo",
      zip: "0154",
    },
  },
);

const deepRecursionModule = c.define(
  "/content/articles.val.ts",
  s.record(
    s.object({
      title: s.string(),
      published: s.boolean(),
      sections: s.array(
        s.object({
          heading: s.string(),
          items: s.array(
            s.union(
              "type",
              s.object({ type: s.literal("text"), content: s.string() }),
              s.object({
                type: s.literal("quote"),
                text: s.string(),
                attribution: s.string(),
              }),
            ),
          ),
        }),
      ),
    }),
  ),
  {
    "getting-started": {
      title: "Getting Started",
      published: true,
      sections: [
        {
          heading: "Introduction",
          items: [
            {
              type: "text",
              content:
                "Welcome to Val. This guide walks you through the basics.",
            },
            {
              type: "quote",
              text: "The best way to predict the future is to create it.",
              attribution: "Peter Drucker",
            },
          ],
        },
        {
          heading: "Installation",
          items: [{ type: "text", content: "Run npm install @valbuild/core" }],
        },
      ],
    },
    "advanced-patterns": {
      title: "Advanced Patterns",
      published: false,
      sections: [
        {
          heading: "Unions & Discriminators",
          items: [
            {
              type: "text",
              content:
                "Discriminated unions let you model variant types safely.",
            },
            {
              type: "quote",
              text: "Make illegal states unrepresentable.",
              attribution: "Yaron Minsky",
            },
          ],
        },
      ],
    },
  },
);

const nullableFieldsModule = c.define(
  "/content/settings.val.ts",
  s.object({
    displayName: s.string().nullable(),
    maxRetries: s.number().nullable(),
    verbose: s.boolean().nullable(),
    metadata: s
      .object({
        description: s.string(),
        version: s.number(),
      })
      .nullable(),
  }),
  {
    displayName: "My App",
    maxRetries: null,
    verbose: null,
    metadata: {
      description: "Main application",
      version: 3,
    },
  },
);

const nestedObjectData = createMockData([nestedObjectModule]);
const deepRecursionData = createMockData([deepRecursionModule]);
const nullableFieldsData = createMockData([nullableFieldsModule]);
const sideBySideData = createMockData([nestedObjectModule]);

// For the "after" side, create modified data
const { s: s2, c: c2 } = initVal();
const nestedObjectModuleAfter = c2.define(
  "/content/profile.val.ts",
  s2.object({
    name: s2.string(),
    age: s2.number(),
    active: s2.boolean(),
    address: s2.object({
      street: s2.string(),
      city: s2.string(),
      zip: s2.string(),
    }),
  }),
  {
    name: "Alice Berntsen",
    age: 33,
    active: false,
    address: {
      street: "Storgata 10",
      city: "Bergen",
      zip: "5003",
    },
  },
);
const sideBySideAfterData = createMockData([nestedObjectModuleAfter]);

// --- Storybook meta ---

const meta: Meta = {
  title: "Components/InlineField",
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="p-8 bg-bg-primary min-h-[200px] max-w-2xl">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj;

// --- Stories ---

export const NestedObjectEditable: Story = {
  name: "Nested Object (Editable)",
  render: () => (
    <StoryProviders mockData={nestedObjectData}>
      <InlineFieldRoot
        moduleFilePath={"/content/profile.val.ts" as ModuleFilePath}
        readonly={false}
      />
    </StoryProviders>
  ),
};

export const NestedObjectReadonly: Story = {
  name: "Nested Object (Readonly)",
  render: () => (
    <StoryProviders mockData={nestedObjectData}>
      <InlineFieldRoot
        moduleFilePath={"/content/profile.val.ts" as ModuleFilePath}
        readonly={true}
      />
    </StoryProviders>
  ),
};

export const DeepRecursion: Story = {
  name: "Deep Recursion (Record > Object > Array > Union)",
  render: () => (
    <StoryProviders mockData={deepRecursionData}>
      <InlineFieldRoot
        moduleFilePath={"/content/articles.val.ts" as ModuleFilePath}
        readonly={false}
      />
    </StoryProviders>
  ),
};

export const NullableFieldsCycle: Story = {
  name: "Nullable Fields",
  render: () => (
    <StoryProviders mockData={nullableFieldsData}>
      <InlineFieldRoot
        moduleFilePath={"/content/settings.val.ts" as ModuleFilePath}
        readonly={false}
      />
    </StoryProviders>
  ),
};

export const SideBySideComparison: Story = {
  name: "Side-by-Side Comparison",
  render: () => (
    <div className="grid grid-cols-2 gap-6">
      <div>
        <div className="text-sm font-medium text-fg-secondary pb-3">
          Before (readonly)
        </div>
        <StoryProviders mockData={sideBySideData}>
          <InlineFieldRoot
            moduleFilePath={"/content/profile.val.ts" as ModuleFilePath}
            readonly={true}
          />
        </StoryProviders>
      </div>
      <div>
        <div className="text-sm font-medium text-fg-secondary pb-3">
          After (editable)
        </div>
        <StoryProviders mockData={sideBySideAfterData}>
          <InlineFieldRoot
            moduleFilePath={"/content/profile.val.ts" as ModuleFilePath}
            readonly={false}
          />
        </StoryProviders>
      </div>
    </div>
  ),
};

const profileModuleFilePath =
  "/content/profile.val.ts" as ModuleFilePath;
const profilePath = profileModuleFilePath as unknown as SourcePath;

export const DirectSourceSchema: Story = {
  name: "Direct Source & Schema (Compare Mode)",
  render: () => (
    <StoryProviders mockData={nestedObjectData}>
      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="text-sm font-medium text-fg-secondary pb-3">
            Old (direct source/schema)
          </div>
          <Field
            label="profile"
            path={profilePath}
            type={nestedObjectData.schemas[profileModuleFilePath].type}
            readonly
            compact
            source={nestedObjectData.sources[profileModuleFilePath]}
            schema={nestedObjectData.schemas[profileModuleFilePath]}
          >
            <AnyField
              path={profilePath}
              schema={nestedObjectData.schemas[profileModuleFilePath]}
              readonly
              compact
              inline
            />
          </Field>
        </div>
        <div>
          <div className="text-sm font-medium text-fg-secondary pb-3">
            Current (from sync engine)
          </div>
          <InlineFieldRoot
            moduleFilePath={profileModuleFilePath}
            readonly={false}
          />
        </div>
      </div>
    </StoryProviders>
  ),
};

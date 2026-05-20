import type { Meta, StoryObj } from "@storybook/react";
import {
  initVal,
  Internal,
  Json,
  ModuleFilePath,
  ReifiedRender,
  SerializedSchema,
  SourcePath,
  ValidationError,
} from "@valbuild/core";
import { JSONValue } from "@valbuild/core/patch";
import { ValClient } from "@valbuild/shared/internal";
import { useMemo, useState } from "react";
import { ValidationErrors } from "./ValidationErrors";
import { ValSyncEngine } from "../ValSyncEngine";
import { ValThemeProvider, Themes } from "./ValThemeProvider";
import { ValErrorProvider } from "./ValErrorProvider";
import { ValPortalProvider } from "./ValPortalProvider";
import { ValFieldProvider } from "./ValFieldProvider";
import { ValRouter } from "./ValRouter";
import { ValRemoteProvider } from "./ValRemoteProvider";
import { TooltipProvider } from "./designSystem/tooltip";

function createMockClient(): ValClient {
  return ((path: string, method: string) => {
    if (path === "/patches" && method === "PUT") {
      return Promise.resolve({ status: 200, json: { newPatchIds: [] } });
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

type MockData = {
  schemas: Record<ModuleFilePath, SerializedSchema>;
  sources: Record<ModuleFilePath, Json>;
  renders: Record<ModuleFilePath, ReifiedRender>;
};

function createMockData(
  modules: ReturnType<ReturnType<typeof initVal>["c"]["define"]>[],
): MockData {
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

const { s, c } = initVal();

const PAGES_PATH = "/app/pages.val.ts" as ModuleFilePath;
const pagesModule = c.define(
  "/app/pages.val.ts",
  s.record(
    s.object({
      title: s.string(),
      body: s.string(),
    }),
  ),
  {
    "/home": { title: "Welcome Home", body: "Welcome to our site." },
    "/about": { title: "About Us", body: "Learn more about our team." },
  },
);

const SETTINGS_PATH = "/app/settings.val.ts" as ModuleFilePath;
const settingsModule = c.define(
  "/app/settings.val.ts",
  s.object({
    siteName: s.string(),
    description: s.string(),
  }),
  { siteName: "My Site", description: "A great site." },
);

const mockData = createMockData([pagesModule, settingsModule]);

function sourcePathOf(
  moduleFilePath: ModuleFilePath,
  segments: string[],
): SourcePath {
  return Internal.joinModuleFilePathAndModulePath(
    moduleFilePath,
    Internal.patchPathToModulePath(segments),
  );
}

const homeTitlePath = sourcePathOf(PAGES_PATH, ["/home", "title"]);
const homeBodyPath = sourcePathOf(PAGES_PATH, ["/home", "body"]);
const aboutTitlePath = sourcePathOf(PAGES_PATH, ["/about", "title"]);
const settingsSiteNamePath = sourcePathOf(SETTINGS_PATH, ["siteName"]);

const sampleErrors: Record<SourcePath, ValidationError[]> = {
  [homeTitlePath]: [{ message: "Title is required." }],
  [homeBodyPath]: [
    { message: "Body must be at least 20 characters." },
    { message: "Body should not contain placeholder text." },
  ],
  [aboutTitlePath]: [{ message: "Title must be at most 60 characters." }],
  [settingsSiteNamePath]: [{ message: "Site name is required." }],
};

function StorySetup({
  errorFields,
  allErrors,
}: {
  errorFields: SourcePath[];
  allErrors: Record<SourcePath, ValidationError[] | undefined>;
}) {
  const client = useMemo(() => createMockClient(), []);
  const engine = useMemo(() => makeEngine(client, mockData), [client]);
  return (
    <StoryProviders syncEngine={engine}>
      <ValidationErrors errorFields={errorFields} allErrors={allErrors} />
    </StoryProviders>
  );
}

const meta: Meta<typeof StorySetup> = {
  title: "Components/ValidationErrors",
  component: StorySetup,
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
type Story = StoryObj<typeof StorySetup>;

export const Empty: Story = {
  args: { errorFields: [], allErrors: {} },
};

export const SingleField: Story = {
  args: {
    errorFields: [homeTitlePath],
    allErrors: sampleErrors,
  },
};

export const MultipleFieldsAcrossModules: Story = {
  args: {
    errorFields: [
      settingsSiteNamePath,
      homeBodyPath,
      aboutTitlePath,
      homeTitlePath,
    ],
    allErrors: sampleErrors,
  },
};

export const SelectedButNoErrorInStore: Story = {
  args: { errorFields: [homeTitlePath], allErrors: {} },
};

export const AllFixed: Story = {
  args: {
    errorFields: [homeTitlePath, homeBodyPath, aboutTitlePath],
    allErrors: {},
  },
};

import type { Meta, StoryObj } from "@storybook/react";
import {
  initVal,
  Internal,
  Json,
  ModuleFilePath,
  SerializedSchema,
} from "@valbuild/core";
import type { ValClient } from "@valbuild/shared/internal";
import { useEffect, useMemo, useState } from "react";
import { Module } from "../Module";
import { ValProvider } from "../ValProvider";
import { ValRouter } from "../ValRouter";
import { Themes } from "../ValThemeProvider";
import { createStorySystem } from "../../stores/react/storySystem";
import { ValSystemProvider } from "../../stores/react/SystemContext";

/**
 * Boolean fields on a phone, before and after they have been changed.
 *
 * A changed field grows a "just now" and an avatar at the right of its header
 * row (`FieldPatchAuthorsSection`, from `Field`). A boolean's checkbox and
 * label share that row, so on a narrow screen the edit marker takes space from
 * the label — and the rows of a module stop lining up with each other.
 *
 * Driven through `Module`, the component the Studio renders for a module, so
 * what is drawn here is what ships. The edits are real patches in the story's
 * patch store, made by clicking or seeded on mount; there is no server, so the
 * avatar is the "Unknown author" fallback, which is the same size as a face.
 */

const { s, c } = initVal();
const MODULE = "/content/settings.val.ts" as ModuleFilePath;

const settingsModule = c.define(
  MODULE,
  s.object({
    title: s.string(),
    published: s.boolean(),
    featured: s.boolean().describe("Shown at the top of the front page"),
    showInNavigationMenu: s.boolean(),
    allowCommentsFromAnonymousVisitors: s
      .boolean()
      .describe("Visitors can comment without signing in"),
    hideFromSearchEngines: s.boolean().nullable(),
  }),
  {
    title: "Sommerkampanje",
    published: true,
    featured: false,
    showInNavigationMenu: true,
    allowCommentsFromAnonymousVisitors: false,
    hideFromSearchEngines: null,
  },
);

function toStoreData(
  modules: ReturnType<ReturnType<typeof initVal>["c"]["define"]>[],
) {
  const schemas: Record<string, SerializedSchema> = {};
  const sources: Record<string, Json> = {};
  for (const module of modules) {
    const moduleFilePath = Internal.getValPath(module);
    const schema = Internal.getSchema(module);
    const source = Internal.getSource(module);
    if (moduleFilePath && schema && source !== undefined) {
      schemas[moduleFilePath] = schema["executeSerialize"]();
      sources[moduleFilePath] = source;
    }
  }
  return {
    schemas: schemas as Record<ModuleFilePath, SerializedSchema>,
    sources: sources as Record<ModuleFilePath, Json>,
  };
}

const storeData = toStoreData([settingsModule]);

function createMockClient(): ValClient {
  return (() =>
    Promise.resolve({
      status: 200,
      json: {
        schemas: {},
        sources: {},
        profiles: [],
        patches: [],
        commits: [],
        deployments: [],
        config: { project: "storybook-boolean-mobile" },
      },
    })) as unknown as ValClient;
}

type SettingsKey =
  | "published"
  | "featured"
  | "showInNavigationMenu"
  | "allowCommentsFromAnonymousVisitors"
  | "hideFromSearchEngines";

function MobileModule({
  changed,
  width,
}: {
  /** Fields that already carry an edit when the story opens. */
  changed: SettingsKey[];
  /** The phone's CSS width. 390 is an iPhone 14/15, 360 a common Android. */
  width: number;
}) {
  const system = useMemo(() => createStorySystem(storeData), []);
  const [theme, setTheme] = useState<Themes | null>("dark");
  const client = useMemo(() => createMockClient(), []);
  useEffect(() => {
    for (const key of changed) {
      const current = (storeData.sources[MODULE] as Record<string, Json>)[key];
      void system.patchStore.createPatch(MODULE, [
        {
          op: "replace",
          path: [key],
          value: current === true ? false : true,
        },
      ]);
    }
    // Seeded when the story opens: later edits are the reader's own clicks.
  }, [system, changed]);
  return (
    <ValSystemProvider system={system}>
      <ValRouter>
        <ValProvider
          client={client}
          config={null}
          dispatchValEvents={false}
          theme={theme}
          setTheme={setTheme}
        >
          <div
            className="min-h-screen bg-bg-primary text-fg-primary p-4"
            style={{ width }}
          >
            {/* Again inside the provider, which mounts a system of its own. */}
            <ValSystemProvider system={system}>
              <Module
                path={Internal.joinModuleFilePathAndModulePath(
                  MODULE,
                  Internal.patchPathToModulePath([]),
                )}
                showModuleGalleryChild={null}
              />
            </ValSystemProvider>
          </div>
        </ValProvider>
      </ValRouter>
    </ValSystemProvider>
  );
}

const meta: Meta<typeof MobileModule> = {
  title: "Fields/Boolean on mobile",
  component: MobileModule,
  parameters: { layout: "fullscreen" },
  args: { width: 390, changed: [] },
};
export default meta;
type Story = StoryObj<typeof MobileModule>;

/** Nothing changed yet: every checkbox and label line up. Click one. */
export const Unchanged: Story = {};

/**
 * Some booleans changed, as after clicking them: each grows "just now" and an
 * avatar on the right of its row, and the rows no longer line up.
 */
export const SomeChanged: Story = {
  args: {
    changed: ["published", "showInNavigationMenu", "hideFromSearchEngines"],
  },
};

/** Every boolean changed, on a narrower Android-sized screen. */
export const AllChangedNarrow: Story = {
  args: {
    width: 360,
    changed: [
      "published",
      "featured",
      "showInNavigationMenu",
      "allowCommentsFromAnonymousVisitors",
      "hideFromSearchEngines",
    ],
  },
};

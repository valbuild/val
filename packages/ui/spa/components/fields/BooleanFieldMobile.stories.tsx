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
 * A changed field grows a "just now" and an avatar (`FieldPatchAuthorsSection`,
 * from `Field`). It used to sit at the right of the header row on every screen,
 * where a boolean's checkbox and label also live, so on a phone it took a third
 * of the row: labels wrapped and the rows of a module stopped lining up. Below
 * the `sm` breakpoint it now gets a line of its own under the label, and the
 * label keeps the width. `WideScreen` is there to show the right-hand column
 * still holds it when there is room.
 *
 * The breakpoint is the VIEWPORT's, so `width` alone does not switch the
 * layout: each story opens in a viewport of the matching size.
 *
 * Driven through `Module`, the component the Studio renders for a module, so
 * what is drawn here is what ships. The edits are real patches in the story's
 * patch store, made by clicking or seeded on mount; there is no server, so the
 * avatar is the "Unknown author" fallback, which is the same size as a face.
 */

const { s, c } = initVal();
const MODULE = "/content/settings.val.ts" as ModuleFilePath;

/** The module's source, typed, so a seeded edit can read what it flips. */
const initialSettings = {
  title: "Sommerkampanje",
  published: true,
  featured: false,
  showInNavigationMenu: true,
  allowCommentsFromAnonymousVisitors: false,
  hideFromSearchEngines: null,
};

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
  initialSettings,
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

type SettingsKey = Exclude<keyof typeof initialSettings, "title">;

function MobileModule({
  changed,
  width,
}: {
  /** Fields that already carry an edit when the story opens. */
  changed: SettingsKey[];
  /** The phone's CSS width. 390 is an iPhone 14/15, 360 a common Android. */
  width: number;
}) {
  // A fresh store whenever the seeded edits change (the Controls panel), so
  // the patches below always start from the module as written, never on top
  // of an earlier set.
  const system = useMemo(() => {
    void changed;
    return createStorySystem(storeData);
  }, [changed]);
  const [theme, setTheme] = useState<Themes | null>("dark");
  const client = useMemo(() => createMockClient(), []);
  useEffect(() => {
    for (const key of changed) {
      const current = initialSettings[key];
      void system.patchStore.createPatch(MODULE, [
        {
          op: "replace",
          path: [key],
          value: current === true ? false : true,
        },
      ]);
    }
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
  // The layout switches on the VIEWPORT (`sm:`), so the phone stories open in
  // a phone-sized one: "Large mobile", 414px, which both widths below fit in.
  globals: { viewport: { value: "mobile2", isRotated: false } },
  args: { width: 390, changed: [] },
};
export default meta;
type Story = StoryObj<typeof MobileModule>;

/** Nothing changed yet: every checkbox and label line up. Click one. */
export const Unchanged: Story = {};

/**
 * Some booleans changed, as after clicking them: each grows a "just now" line
 * under its label, and the labels keep their width.
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

/** The same edits with room to spare: the history stays in the right column. */
export const WideScreen: Story = {
  globals: { viewport: { value: "tablet", isRotated: false } },
  args: {
    width: 720,
    changed: ["published", "showInNavigationMenu", "hideFromSearchEngines"],
  },
};

import type { Meta, StoryObj } from "@storybook/react";
import {
  initVal,
  Internal,
  Json,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";
import type { HistoricalPatchSet, ValClient } from "@valbuild/shared/internal";
import { useMemo, useState } from "react";
import { Module } from "../components/Module";
import { TooltipProvider } from "../components/designSystem/tooltip";
import { ValProvider } from "../components/ValProvider";
import { ValRouter } from "../components/ValRouter";
import { Themes } from "../components/ValThemeProvider";
import { createStorySystem } from "../stores/react/storySystem";
import { ValSystemProvider } from "../stores/react/SystemContext";
import { HistoryPane } from "./HistoryPane";
import { HistorySplit } from "./HistorySplit";
import { RestoreModeProvider, type RestoreMode } from "./RestoreModeContext";

/**
 * Restore mode, driven through the components that actually ship.
 *
 * There is no story-only chrome here. The marks and the pick targets come from
 * `Field` reading `RestoreModeProvider` — the same path the Studio takes — so
 * what these screens show is what the feature does, not a drawing of it.
 *
 * `SchemaChanged` is the load-bearing one: `cta` was a plain object at the
 * commit and is a union today, and the union still contains that shape, so the
 * left `cta` is offered while everything else is refused with a reason.
 */

const { s, c } = initVal();
const MODULE = "/content/landing.val.ts" as ModuleFilePath;

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

const now = toStoreData([
  c.define(
    MODULE,
    s.object({
      heading: s.string(),
      tagline: s.string(),
      cta: s.union(
        "kind",
        s.object({
          kind: s.literal("link"),
          label: s.string(),
          href: s.string(),
        }),
        s.object({
          kind: s.literal("button"),
          label: s.string(),
          variant: s.string(),
        }),
      ),
      readingMinutes: s.number(),
    }),
    {
      heading: "Content, super-charged",
      tagline: "Ship copy without shipping code.",
      cta: { kind: "button", label: "Start building", variant: "primary" },
      readingMinutes: 4,
    },
  ),
]);

const atCommit = toStoreData([
  c.define(
    MODULE,
    s.object({
      heading: s.string(),
      tagline: s.string(),
      cta: s.object({
        kind: s.literal("link"),
        label: s.string(),
        href: s.string(),
      }),
      readingMinutes: s.number(),
    }),
    {
      heading: "Content as code",
      tagline: "Type-safe content for your Next.js app.",
      cta: { kind: "link", label: "Get started", href: "/docs" },
      readingMinutes: 3,
    },
  ),
]);

/** The wire carries `JSONValue`; `c.define` yields `Source`. A round trip. */
function asWire(value: Json): JSONValue {
  return JSON.parse(JSON.stringify(value));
}

function patchSetOf(): HistoricalPatchSet {
  return {
    commit: {
      commitSha: "7b21e40",
      parentCommitSha: "p1",
      clientCommitSha: "c1",
      branch: "main",
      createdBranch: null,
      creator: "Fredrik",
      message: "Rework the hero",
      createdAt: "2026-06-01T10:00:00.000Z",
      seqNum: "12",
      patchCount: 2,
      hasArchive: true,
    },
    modules: {
      [MODULE]: {
        source: asWire(atCommit.sources[MODULE]),
        schema: atCommit.schemas[MODULE],
        patchIds: [],
        changedPaths: [],
        failures: [],
      },
    },
    patches: [],
    jsonEntries: {},
    binaryFiles: [],
    warnings: [],
  };
}

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
        config: { project: "storybook-history" },
      },
    })) as unknown as ValClient;
}

/**
 * The story stands in for `useDirectedRestore`, which needs the router and a
 * live client. What it hands the panes is the same `RestoreMode` shape they get
 * in the Studio, so everything below it is the real thing.
 */
function Panes({ initialFrom }: { initialFrom?: string }) {
  const nowSystem = useMemo(() => createStorySystem(now), []);
  const [theme, setTheme] = useState<Themes | null>("dark");
  const client = useMemo(() => createMockClient(), []);
  const path = `${MODULE}?p=` as SourcePath;
  const [from, setFrom] = useState<RestoreMode["from"]>(() => {
    if (!initialFrom) return null;
    const source = atCommit.sources[MODULE];
    const schema = atCommit.schemas[MODULE];
    if (schema.type !== "object" || typeof source !== "object" || !source) {
      return null;
    }
    return {
      path: `${MODULE}?p=${JSON.stringify(initialFrom)}` as SourcePath,
      value: (source as Record<string, Json>)[initialFrom],
      schema: schema.items[initialFrom],
    };
  });
  const [toPath, setToPath] = useState<SourcePath | null>(null);

  const shared = {
    from,
    toPath,
    onPickSource: (
      pickedPath: SourcePath,
      value: Json,
      schema: SerializedSchema,
    ) => {
      setFrom({ path: pickedPath, value, schema });
      setToPath(null);
    },
    onPickTarget: (pickedPath: SourcePath) => setToPath(pickedPath),
  };

  return (
    <ValSystemProvider system={nowSystem}>
      <TooltipProvider>
        <ValRouter>
          <ValProvider
            client={client}
            config={null}
            dispatchValEvents={false}
            theme={theme}
            setTheme={setTheme}
          >
            <div className="flex min-h-[620px] w-full bg-bg-primary p-4">
              <HistorySplit
                breakpoint="desktop"
                commitLabel="At 7b21e40"
                editor={
                  <RestoreModeProvider mode={{ side: "now", ...shared }}>
                    <ValSystemProvider system={nowSystem}>
                      <div className="p-2">
                        <Module path={path} showModuleGalleryChild={null} />
                      </div>
                    </ValSystemProvider>
                  </RestoreModeProvider>
                }
                history={
                  <HistoryPane
                    patchSet={patchSetOf()}
                    path={path}
                    loading={false}
                    error={null}
                    wrapModule={(module) => (
                      <RestoreModeProvider mode={{ side: "commit", ...shared }}>
                        {module}
                      </RestoreModeProvider>
                    )}
                  />
                }
              />
            </div>
          </ValProvider>
        </ValRouter>
      </TooltipProvider>
    </ValSystemProvider>
  );
}

const meta: Meta<typeof Panes> = {
  title: "History/Restore mode",
  component: Panes,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof Panes>;

/** Restore mode entered, nothing picked: the left pane is not yet marked. */
export const PickingSource: Story = { args: {} };

/**
 * `cta` picked on the right, where it was a plain object. Today it is a union
 * that still contains that shape, so the left `cta` is offered and every other
 * field is refused with a reason — all before anyone clicks.
 */
export const SchemaChanged: Story = { args: { initialFrom: "cta" } };

/**
 * Cross-path restore: an old headline can go into today's tagline, because
 * each field is asked rather than matched by name.
 */
export const CrossPath: Story = { args: { initialFrom: "heading" } };

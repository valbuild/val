import type { Meta, StoryObj } from "@storybook/react";
import {
  initVal,
  Internal,
  Json,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import type { HistoricalPatchSet } from "@valbuild/shared/internal";
import type { JSONValue } from "@valbuild/core/patch";
import { useMemo, useState } from "react";
import { TooltipProvider } from "../components/designSystem/tooltip";
import { ValProvider } from "../components/ValProvider";
import { ValRouter } from "../components/ValRouter";
import { Themes } from "../components/ValThemeProvider";
import { createStorySystem } from "../stores/react/storySystem";
import { ValSystemProvider } from "../stores/react/SystemContext";
import { ValClient } from "@valbuild/shared/internal";
import { HistoryPane } from "./HistoryPane";
import { HistorySplit } from "./HistorySplit";
import { Module } from "../components/Module";

/**
 * The two-pane history Studio, with the real components on both sides.
 *
 * The left is the editor. The right is `HistoryPane`, which renders the SAME
 * `Module` component through a system built from the commit — so what makes the
 * past render is one provider, and no field component knows this feature is
 * here.
 *
 * `SchemaChanged` is the one to look at: the commit's schema differs from
 * today's, and the right pane draws the commit's, which is the thing that was
 * impossible before the schema was stored.
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
      cta: s.discriminatedUnion(
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
    }),
    {
      heading: "Content, super-charged",
      cta: { kind: "button", label: "Start building", variant: "primary" },
    },
  ),
]);

/** What the commit stored: its own schema, and its own data. */
const atCommit = toStoreData([
  c.define(
    MODULE,
    s.object({
      heading: s.string(),
      cta: s.object({ label: s.string(), href: s.string() }),
    }),
    {
      heading: "Content as code",
      cta: { label: "Get started", href: "/docs" },
    },
  ),
]);

/**
 * Story data is authored with `c.define`, which yields `Source` (readonly
 * arrays); the wire carries `JSONValue` (mutable ones). A round trip is what
 * genuinely happens between the two — it is how the value reaches the Studio in
 * the first place — so doing it here is the honest conversion rather than an
 * assertion that the two types are the same.
 */
function asWire(value: Json): JSONValue {
  return JSON.parse(JSON.stringify(value));
}

function patchSetOf(
  data: ReturnType<typeof toStoreData>,
  overrides?: Partial<HistoricalPatchSet["modules"][string]>,
): HistoricalPatchSet {
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
        source: asWire(data.sources[MODULE]),
        schema: data.schemas[MODULE],
        patchIds: [],
        changedPaths: [],
        failures: [],
        ...overrides,
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

function Panes({
  patchSet,
  breakpoint,
}: {
  patchSet: HistoricalPatchSet;
  breakpoint: "mobile" | "desktop";
}) {
  const nowSystem = useMemo(() => createStorySystem(now), []);
  const [theme, setTheme] = useState<Themes | null>("dark");
  const client = useMemo(() => createMockClient(), []);
  const path = `${MODULE}?p=` as SourcePath;
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
            <div
              className={
                "flex min-h-[560px] bg-bg-primary p-4 " +
                (breakpoint === "mobile" ? "w-[420px]" : "w-full")
              }
            >
              <HistorySplit
                breakpoint={breakpoint}
                commitLabel="At 7b21e40"
                editor={
                  /*
                   * The story states its left pane's system explicitly.
                   *
                   * `ValProvider` builds its own system from the client it is
                   * given (see ValProvider.tsx), which in the real Studio is
                   * the Studio's — the editor column needs no provider of its
                   * own. Here the client is a mock that answers nothing, so
                   * without this the left pane would spin forever against an
                   * empty system and the story would be showing a bug it does
                   * not have.
                   */
                  <ValSystemProvider system={nowSystem}>
                    <div className="p-2">
                      <Module path={path} showModuleGalleryChild={null} />
                    </div>
                  </ValSystemProvider>
                }
                history={
                  <HistoryPane
                    patchSet={patchSet}
                    path={path}
                    loading={false}
                    error={null}
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
  title: "History/Two-pane Studio",
  component: Panes,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof Panes>;

/**
 * The case the design turns on: `cta` was a plain object at the commit and is a
 * union today. The right pane draws the commit's schema, so the old shape
 * renders as what it was rather than against a shape it never had.
 */
export const SchemaChanged: Story = {
  args: { patchSet: patchSetOf(atCommit), breakpoint: "desktop" },
};

/**
 * A module saved by a Val whose schema format this one does not know.
 *
 * Not an error state, and deliberately not worded like one — nothing is lost
 * and nothing is broken. The rest of the commit still reads.
 */
export const SchemaFromAnotherVal: Story = {
  args: {
    patchSet: patchSetOf(atCommit, {
      schema: null,
      failures: [
        {
          kind: "schema-unreadable",
          moduleFilePath: MODULE,
          message: "unknown schema type: 'portableText'",
        },
      ],
    }),
    breakpoint: "desktop",
  },
};

/** On a phone: one pane and a toggle, with both kept mounted. */
export const Mobile: Story = {
  args: { patchSet: patchSetOf(atCommit), breakpoint: "mobile" },
};

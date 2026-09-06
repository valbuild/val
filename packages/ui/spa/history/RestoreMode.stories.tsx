import type { Meta, StoryObj } from "@storybook/react";
import {
  initVal,
  Internal,
  Json,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import {
  checkCompatibility,
  type Compatibility,
  type ValClient,
} from "@valbuild/shared/internal";
import { useMemo, useState } from "react";
import { AnyField } from "../components/AnyField";
import { TooltipProvider } from "../components/designSystem/tooltip";
import { ValProvider } from "../components/ValProvider";
import { ValRouter } from "../components/ValRouter";
import { Themes } from "../components/ValThemeProvider";
import type { System } from "../stores/createSystem";
import { createStorySystem } from "../stores/react/storySystem";
import { ValSystemProvider } from "../stores/react/SystemContext";
import { sourcePathOfItem } from "../utils/sourcePathOfItem";
import {
  applyHistoryParams,
  enterRestore,
  pickRestoreSource,
  pickRestoreTarget,
  type HistoryParams,
} from "./historyParams";
import { RestoreTarget } from "./RestoreTarget";

/**
 * Restore mode: pick on the right, then pick on the left.
 *
 * The two things worth looking at in these screens:
 *
 * 1. **The left pane is marked before anything is clicked.** Once a value is
 *    picked on the right, every field on the left says whether it can hold it.
 *    Nobody has to try a restore to find out it was refused.
 * 2. **The URL is the state.** The strip at the top is not decoration — it is
 *    the actual query the panes are rendered from, so every stage of a restore
 *    is a link that reloads into exactly this screen.
 *
 * `SchemaChanged` is still the load-bearing case: `cta` was a plain object at
 * the commit and is a union today, and the old value goes back in fine because
 * the union still contains its shape.
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

type StoreData = ReturnType<typeof toStoreData>;

// --- the content: today's schema, and the one at the commit ---

const nowData = toStoreData([
  c.define(
    MODULE,
    s.object({
      heading: s.string(),
      tagline: s.string(),
      // Today a union. At the commit it was the plain object below.
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

const atCommitData = toStoreData([
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

// --- reading a field out of the story data ---

type FieldRef = {
  key: string;
  path: SourcePath;
  schema: SerializedSchema;
  value: Json;
};

/**
 * The top-level fields of the module, as the panes offer them.
 *
 * Top-level only because these stories are about the mechanism, not about
 * navigation — the real thing marks whatever the panes are showing, at whatever
 * depth the Studio has been navigated to.
 */
function fieldsOf(data: StoreData): FieldRef[] {
  const schema = data.schemas[MODULE];
  const source = data.sources[MODULE];
  if (schema.type !== "object" || typeof source !== "object" || !source) {
    return [];
  }
  const record: Record<string, Json> = source as Record<string, Json>;
  return Object.entries(schema.items).map(([key, itemSchema]) => ({
    key,
    path: sourcePathOfItem(MODULE, key),
    schema: itemSchema,
    value: record[key] ?? null,
  }));
}

function findField(data: StoreData, path: SourcePath): FieldRef | undefined {
  return fieldsOf(data).find((field) => field.path === path);
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

function StudioProviders({
  children,
  system,
}: {
  children: React.ReactNode;
  system: System;
}) {
  const [theme, setTheme] = useState<Themes | null>("dark");
  const client = useMemo(() => createMockClient(), []);
  return (
    <ValSystemProvider system={system}>
      <TooltipProvider>
        <ValRouter>
          <ValProvider
            client={client}
            config={null}
            dispatchValEvents={false}
            theme={theme}
            setTheme={setTheme}
          >
            {children}
          </ValProvider>
        </ValRouter>
      </TooltipProvider>
    </ValSystemProvider>
  );
}

/**
 * The URL, shown rather than described.
 *
 * In a story there is no address bar to point at, and the deep-linking is the
 * part of this design that is easiest to claim and hardest to see.
 */
function UrlStrip({ state }: { state: HistoryParams }) {
  const query = applyHistoryParams(new URLSearchParams("p="), state).toString();
  return (
    <div className="overflow-x-auto rounded-lg border border-border-primary bg-bg-secondary px-3 py-2">
      <code className="whitespace-nowrap font-mono text-[11px] text-fg-tertiary">
        /val/~{MODULE}?{decodeURIComponent(query)}
      </code>
    </div>
  );
}

function PaneShell({
  title,
  subtitle,
  tone,
  children,
}: {
  title: string;
  subtitle: string;
  tone: "now" | "commit";
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        "flex min-w-0 flex-1 flex-col rounded-lg border border-border-primary " +
        (tone === "commit" ? "bg-bg-secondary" : "bg-bg-primary")
      }
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-border-primary px-4 py-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-fg-primary">{title}</span>
          <span className="font-mono text-xs text-fg-tertiary">{subtitle}</span>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-3 p-4">{children}</div>
    </div>
  );
}

/** The field's name, which the panes' own chrome would otherwise swallow. */
function FieldBody({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-mono text-[11px] uppercase tracking-wider text-fg-tertiary">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * A field on the commit side, offered as the thing to restore.
 *
 * Nothing to check here: a value at a commit is always a legal value of the
 * schema it was stored under. Compatibility is a question about where it is
 * going, which is why the marks are all on the other pane.
 */
function RestoreSource({
  field,
  selected,
  onSelect,
  children,
}: {
  field: FieldRef;
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onSelect();
        }
      }}
      className={
        "cursor-pointer rounded-lg border p-3 transition-colors " +
        (selected
          ? "border-fg-brand-primary ring-1 ring-fg-brand-primary"
          : "border-border-primary hover:border-fg-brand-primary")
      }
      data-restore-source={field.key}
    >
      <div className="mb-2">
        <span className="inline-flex items-center gap-1 rounded border border-border-primary px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-tertiary">
          {selected ? "Restoring this" : "Restore this"}
        </span>
      </div>
      {children}
    </div>
  );
}

function RestorePanes({
  now,
  atCommit,
  commitSha,
  commitWhen,
  initialFrom,
}: {
  now: StoreData;
  atCommit: StoreData;
  commitSha: string;
  commitWhen: string;
  /** Deep-link straight into a stage, the way a shared link would. */
  initialFrom?: string;
}) {
  const nowSystem = useMemo(() => createStorySystem(now), [now]);
  const commitSystem = useMemo(() => createStorySystem(atCommit), [atCommit]);
  const [state, setState] = useState<HistoryParams>(() => {
    const base = enterRestore({
      commitSha,
      locked: true,
      rightPath: null,
      restore: { mode: "off" },
    });
    return initialFrom
      ? pickRestoreSource(base, sourcePathOfItem(MODULE, initialFrom))
      : base;
  });

  const from =
    state.restore.mode === "picking-target" ||
    state.restore.mode === "confirming"
      ? findField(atCommit, state.restore.from)
      : undefined;
  const to =
    state.restore.mode === "confirming"
      ? findField(now, state.restore.to)
      : undefined;

  /**
   * The marks, computed once for the whole left pane.
   *
   * Every field, not just the one with the same name: a restore is allowed to
   * cross paths (an old headline into today's tagline), so the question is
   * asked of each candidate rather than assumed from the key.
   */
  const marks = useMemo<Map<SourcePath, Compatibility>>(() => {
    const result = new Map<SourcePath, Compatibility>();
    if (!from) return result;
    for (const candidate of fieldsOf(now)) {
      result.set(
        candidate.path,
        checkCompatibility(
          { schema: from.schema, value: from.value },
          { schema: candidate.schema },
        ),
      );
    }
    return result;
  }, [from, now]);

  return (
    <StudioProviders system={nowSystem}>
      <div className="flex min-h-[620px] w-full flex-col gap-4 bg-bg-primary p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-fg-primary">
              Restore from {commitSha}
            </span>
            <span className="text-xs text-fg-secondary">
              {to && from
                ? `“${from.key}” goes into “${to.key}”. Nothing is written until you stage it.`
                : from
                  ? `Pick where “${from.key}” should go.`
                  : "Pick a field on the right to restore."}
            </span>
          </div>
          {to && from && (
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-fg-secondary">
                {from.key} → {to.key}
              </span>
              <button className="rounded bg-bg-brand-primary px-3 py-1.5 text-sm font-medium text-fg-brand-primary-alt">
                Stage restore
              </button>
            </div>
          )}
        </div>
        <UrlStrip state={state} />
        <div className="flex min-w-0 gap-4">
          <PaneShell title="Now" subtitle="main · working copy" tone="now">
            {fieldsOf(now).map((field) => {
              const compatibility: Compatibility = marks.get(field.path) ?? {
                status: "unknown",
                message: "Nothing picked yet.",
              };
              const body = (
                <FieldBody label={field.key}>
                  <ValSystemProvider system={nowSystem}>
                    <AnyField
                      path={field.path}
                      schema={field.schema}
                      compact
                      errorDisplay="none"
                    />
                  </ValSystemProvider>
                </FieldBody>
              );
              if (!from) {
                return (
                  <div
                    key={field.key}
                    className="rounded-lg border border-border-primary p-3 opacity-60"
                  >
                    {body}
                  </div>
                );
              }
              return (
                <RestoreTarget
                  key={field.key}
                  compatibility={compatibility}
                  selected={
                    state.restore.mode === "confirming" &&
                    state.restore.to === field.path
                  }
                  onSelect={() =>
                    setState((prev) => pickRestoreTarget(prev, field.path))
                  }
                >
                  {body}
                </RestoreTarget>
              );
            })}
          </PaneShell>
          <PaneShell
            title={`At ${commitSha}`}
            subtitle={commitWhen}
            tone="commit"
          >
            {fieldsOf(atCommit).map((field) => (
              <RestoreSource
                key={field.key}
                field={field}
                selected={from?.path === field.path}
                onSelect={() =>
                  setState((prev) => pickRestoreSource(prev, field.path))
                }
              >
                <FieldBody label={field.key}>
                  <ValSystemProvider system={commitSystem}>
                    <AnyField
                      path={field.path}
                      schema={field.schema}
                      readonly
                      compact
                      errorDisplay="none"
                    />
                  </ValSystemProvider>
                </FieldBody>
              </RestoreSource>
            ))}
          </PaneShell>
        </div>
      </div>
    </StudioProviders>
  );
}

const meta: Meta<typeof RestorePanes> = {
  title: "History/Restore mode",
  component: RestorePanes,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof RestorePanes>;

const baseArgs = {
  now: nowData,
  atCommit: atCommitData,
  commitSha: "7b21e40",
  commitWhen: "3 months ago · Fredrik",
};

/** Restore mode entered, nothing picked. The left pane is not yet marked. */
export const PickingSource: Story = { args: baseArgs };

/**
 * The load-bearing one.
 *
 * `cta` is picked on the right, where it was a plain object. Today it is a
 * union — and the union still contains that shape, so the left `cta` is
 * offered. Every other field is refused with a reason, before anyone clicks.
 */
export const SchemaChanged: Story = {
  args: { ...baseArgs, initialFrom: "cta" },
};

/**
 * Cross-path restore: an old headline can go into today's tagline.
 *
 * Both are strings, so both are offered — which is the point of asking each
 * field rather than matching by name.
 */
export const CrossPath: Story = {
  args: { ...baseArgs, initialFrom: "heading" },
};

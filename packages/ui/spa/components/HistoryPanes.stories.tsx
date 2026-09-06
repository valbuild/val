import type { Meta, StoryObj } from "@storybook/react";
import {
  initVal,
  Internal,
  Json,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { useMemo, useState } from "react";
import { createStorySystem } from "../stores/react/storySystem";
import type { System } from "../stores/createSystem";
import { ValSystemProvider } from "../stores/react/SystemContext";
import { Themes } from "./ValThemeProvider";
import { ValRouter } from "./ValRouter";
import { TooltipProvider } from "./designSystem/tooltip";
import { ValProvider } from "./ValProvider";
import { ValClient } from "@valbuild/shared/internal";
import { AnyField } from "./AnyField";

/**
 * Does the two-pane history Studio need every field component refactored?
 *
 * No — and these stories are the evidence. Every read hook a field uses reaches
 * its stores through `useValSystem()`, which is one `useContext` call. So a
 * second `ValSystemProvider` around the right pane swaps SOURCE AND SCHEMA
 * together for that subtree, and the real field renderers follow without
 * knowing they are rendering history.
 *
 * `SchemaChanged` is the one that matters: the two panes render the same path
 * against genuinely different schemas at the same time, which is what a commit
 * from before a schema change actually needs.
 */

const { s, c } = initVal();

// --- turning modules into what a story system wants ---

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

const MODULE = "/content/landing.val.ts" as ModuleFilePath;

// --- the pane chrome (story-local: the mechanism is the subject, not this) ---

function Pane({
  side,
  title,
  subtitle,
  system,
  path,
  schema,
  readonly,
}: {
  side: "left" | "right";
  title: string;
  subtitle: string;
  system: System;
  path: SourcePath;
  schema: SerializedSchema;
  readonly?: boolean;
}) {
  return (
    <div
      className={
        "flex min-w-0 flex-1 flex-col rounded-lg border " +
        (side === "right"
          ? "border-border-primary bg-bg-secondary"
          : "border-border-primary bg-bg-primary")
      }
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-border-primary px-4 py-3">
        <div className="flex flex-col">
          <span className="text-text-primary text-sm font-semibold">
            {title}
          </span>
          <span className="text-text-quartenary font-mono text-xs">
            {subtitle}
          </span>
        </div>
        {readonly && (
          <span className="text-text-quartenary rounded border border-border-primary px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider">
            read only
          </span>
        )}
      </div>
      <div className="min-w-0 p-4">
        {/* The whole mechanism, in one line: a second system for this subtree.
            Every read hook below reaches its stores through useValSystem(),
            so source AND schema swap together and the real field renderers
            follow without knowing they are rendering history. */}
        <ValSystemProvider system={system}>
          <AnyField path={path} schema={schema} readonly={readonly} />
        </ValSystemProvider>
      </div>
    </div>
  );
}

function createMockClient(): ValClient {
  return (() =>
    Promise.resolve({
      status: 200,
      json: {
        schemas: {},
        sources: {},
        // Arrays, not omissions: the profiles response is iterated on arrival,
        // so a missing key is a TypeError rather than an empty list.
        profiles: [],
        patches: [],
        commits: [],
        deployments: [],
        config: { project: "storybook-history" },
      },
    })) as unknown as ValClient;
}

/**
 * Everything that is shared between the panes, mounted once.
 *
 * Auth, the client, deployments — none of that is per-pane, and `ValProvider`
 * renders the field-provider stack itself. The per-pane system goes INSIDE, in
 * `Pane`, which is why this wrapper knows nothing about history.
 */
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

function TwoPanes({
  now,
  atCommit,
  commitSha,
  commitWhen,
  path,
}: {
  now: ReturnType<typeof toStoreData>;
  atCommit: ReturnType<typeof toStoreData>;
  commitSha: string;
  commitWhen: string;
  path: SourcePath;
}) {
  const nowSystem = useMemo(() => createStorySystem(now), [now]);
  const commitSystem = useMemo(() => createStorySystem(atCommit), [atCommit]);
  return (
    <StudioProviders system={nowSystem}>
      <div className="bg-bg-primary flex min-h-[520px] w-full gap-4 p-6">
        <Pane
          side="left"
          title="Now"
          subtitle="main · working copy"
          system={nowSystem}
          path={path}
          schema={now.schemas[MODULE]}
        />
        <Pane
          side="right"
          title={`At ${commitSha}`}
          subtitle={commitWhen}
          system={commitSystem}
          path={path}
          schema={atCommit.schemas[MODULE]}
          readonly
        />
      </div>
    </StudioProviders>
  );
}

// --- content ---

const nowData = toStoreData([
  c.define(
    MODULE,
    s.object({
      heading: s.string(),
      tagline: s.string(),
      ctaLabel: s.string(),
    }),
    {
      heading: "Content, super-charged",
      tagline: "Edit in place. Publish when you mean to.",
      ctaLabel: "Start building",
    },
  ),
]);

const atCommitData = toStoreData([
  c.define(
    MODULE,
    s.object({
      heading: s.string(),
      tagline: s.string(),
      ctaLabel: s.string(),
    }),
    {
      heading: "Content as code",
      tagline: "Type-safe content for your Next.js app.",
      ctaLabel: "Get started",
    },
  ),
]);

const meta: Meta<typeof TwoPanes> = {
  title: "History/Two-pane Studio",
  component: TwoPanes,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof TwoPanes>;

/**
 * The common case: same schema on both sides, different values, panes locked to
 * the same path. Both sides are real field renderers reading real stores — the
 * right one just has a different system behind it.
 */
export const LockedSamePath: Story = {
  args: {
    now: nowData,
    atCommit: atCommitData,
    commitSha: "a3f19c2",
    commitWhen: "12 days ago · Fredrik",
    path: `${MODULE}?p=` as SourcePath,
  },
};

/**
 * The case the whole design turns on.
 *
 * At the commit, `cta` was a plain string. Today it is a union of
 * `link` and `button`. The two panes render the same path against two
 * different schemas at once — which is exactly what a second system buys, and
 * what a schema-less source override could not do.
 */
const schemaChangedNow = toStoreData([
  c.define(
    MODULE,
    s.object({
      heading: s.string(),
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
    }),
    {
      heading: "Content, super-charged",
      cta: { kind: "button", label: "Start building", variant: "primary" },
    },
  ),
]);

const schemaChangedAtCommit = toStoreData([
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

export const SchemaChanged: Story = {
  args: {
    now: schemaChangedNow,
    atCommit: schemaChangedAtCommit,
    commitSha: "7b21e40",
    commitWhen: "3 months ago · Fredrik",
    path: `${MODULE}?p=` as SourcePath,
  },
};

/**
 * Mobile: one pane at a time with a toggle, rather than two columns.
 */
function MobilePanes(props: React.ComponentProps<typeof TwoPanes>) {
  const [showing, setShowing] = useState<"now" | "commit">("commit");
  const nowSystem = useMemo(() => createStorySystem(props.now), [props.now]);
  const commitSystem = useMemo(
    () => createStorySystem(props.atCommit),
    [props.atCommit],
  );
  return (
    <StudioProviders system={nowSystem}>
      <div className="bg-bg-primary flex min-h-[520px] w-full max-w-[420px] flex-col gap-3 p-4">
        <div className="flex gap-1 rounded-lg border border-border-primary p-1">
          {(
            [
              ["now", "Now"],
              ["commit", `At ${props.commitSha}`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setShowing(key)}
              className={
                "flex-1 rounded px-3 py-1.5 text-sm " +
                (showing === key
                  ? "bg-bg-brand-primary text-text-primary font-medium"
                  : "text-text-quartenary")
              }
            >
              {label}
            </button>
          ))}
        </div>
        {showing === "now" ? (
          <Pane
            side="left"
            title="Now"
            subtitle="main · working copy"
            system={nowSystem}
            path={props.path}
            schema={props.now.schemas[MODULE]}
          />
        ) : (
          <Pane
            side="right"
            title={`At ${props.commitSha}`}
            subtitle={props.commitWhen}
            system={commitSystem}
            path={props.path}
            schema={props.atCommit.schemas[MODULE]}
            readonly
          />
        )}
      </div>
    </StudioProviders>
  );
}

export const Mobile: Story = {
  render: (args) => <MobilePanes {...args} />,
  args: {
    now: nowData,
    atCommit: atCommitData,
    commitSha: "a3f19c2",
    commitWhen: "12 days ago · Fredrik",
    path: `${MODULE}?p=` as SourcePath,
  },
};

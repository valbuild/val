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
import { useMemo, useState } from "react";
import { AnyField } from "../AnyField";
import { Field } from "../Field";
import { createStorySystem } from "../../stores/react/storySystem";
import { ValSystemProvider } from "../../stores/react/SystemContext";
import { ValThemeProvider, Themes } from "../ValThemeProvider";
import { ValErrorProvider } from "../ValErrorProvider";
import { ValPortalProvider } from "../ValPortalProvider";
import { ValFieldProvider, useSchemaAtPath } from "../ValFieldProvider";
import { ValRouter } from "../ValRouter";
import { TooltipProvider } from "../designSystem/tooltip";
import { sourcePathOfItem } from "../../utils/sourcePathOfItem";

/**
 * A value that is `null`, in the two places the Studio draws one.
 *
 * These stories exist because the two places disagreed. A field INSIDE an
 * object gets a {@link Field} wrapper, which has offered a create toggle for a
 * null source for as long as it has existed. A field opened ON ITS OWN — which
 * is what navigating to an array item or a record entry does — has no wrapper,
 * and used to render the item schema's children straight over the `null`: a
 * column of "Not Found", one per field, for a value that simply is not written.
 *
 * Both shapes are here so the two can be compared at a glance, and so the
 * wording for a locale-keyed record ("not translated" rather than "empty") has
 * somewhere to be looked at.
 *
 * Same story harness as InlineField.stories.tsx: real modules built with
 * initVal, serialized and previewed the way the app does it.
 */

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

type MockData = ReturnType<typeof createMockData>;

function StoryProviders({
  children,
  mockData,
}: {
  children: React.ReactNode;
  mockData: MockData;
}) {
  const [theme, setTheme] = useState<Themes | null>("dark");
  const system = useMemo(
    () =>
      createStorySystem({
        schemas: mockData.schemas,
        sources: mockData.sources,
        previews: mockData.previews,
      }),
    [mockData],
  );
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
                  {children}
                </ValFieldProvider>
              </ValPortalProvider>
            </ValErrorProvider>
          </ValRouter>
        </TooltipProvider>
      </ValThemeProvider>
    </ValSystemProvider>
  );
}

/**
 * What the module editor renders for a path: the field, with NO `Field`
 * wrapper around it. See `Module.tsx` — this is the line that used to draw
 * "Not Found" once per child.
 */
function NavigatedTo({
  path,
  compact,
}: {
  path: SourcePath;
  /**
   * The story harness has no `ValProvider` — see InlineField.stories.tsx — and
   * a full-size `Field` reaches it for the patch-authors row. Only a pane that
   * draws a WRITTEN object needs this; a null one draws no `Field` at all.
   */
  compact?: boolean;
}) {
  const schemaAtPath = useSchemaAtPath(path);
  if (schemaAtPath.status !== "success") {
    return <div>Loading…</div>;
  }
  return <AnyField path={path} schema={schemaAtPath.data} compact={compact} />;
}

/** The same value as a labelled row inside its parent — the `Field` wrapper. */
function InsideAField({ path, label }: { path: SourcePath; label: string }) {
  const schemaAtPath = useSchemaAtPath(path);
  if (schemaAtPath.status !== "success") {
    return <div>Loading…</div>;
  }
  return (
    <Field label={label} path={path} type={schemaAtPath.data.type} compact>
      <AnyField path={path} schema={schemaAtPath.data} compact />
    </Field>
  );
}

function Pane({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-sm font-medium text-fg-secondary pb-3">{title}</div>
      {children}
    </div>
  );
}

// --- Modules ---

const { s, c } = initVal();

const sectionSchema = s.object({
  heading: s.string(),
  body: s.string(),
});

/**
 * The case in the title: an array whose items may be `null`. Index 1 is one.
 */
const nullableArrayModule = c.define(
  "/content/sections.val.ts",
  s.array(sectionSchema.nullable()),
  [
    { heading: "Ships on Fridays", body: "Every Friday, and never on one." },
    null,
    { heading: "A note on sizing", body: "Runs small. Take one size up." },
  ],
);

const ARRAY_PATH = "/content/sections.val.ts" as unknown as SourcePath;
const ARRAY_NULL_ITEM = sourcePathOfItem(ARRAY_PATH, 1);
const ARRAY_WRITTEN_ITEM = sourcePathOfItem(ARRAY_PATH, 0);

/**
 * The same state arrived at the other way: a record whose key schema declares
 * its keys holds every one of them, and an entry nobody has written is `null`.
 */
const localeRecordModule = c.define(
  "/content/announcements.val.ts",
  s.record(s.locale(), sectionSchema),
  {
    "en-US": {
      heading: "We ship on Fridays",
      body: "Every Friday, and never on a Friday.",
    },
    "nb-NO": null,
  },
);

const RECORD_PATH = "/content/announcements.val.ts" as unknown as SourcePath;
const RECORD_NULL_ENTRY = sourcePathOfItem(RECORD_PATH, "nb-NO");

/** A record with the same shape whose keys are NOT languages, for contrast. */
const openRecordModule = c.define(
  "/content/fragments.val.ts",
  s.record(s.string(), sectionSchema.nullable()),
  {
    intro: { heading: "Intro", body: "The first thing anyone reads." },
    outro: null,
  },
);

const OPEN_RECORD_PATH = "/content/fragments.val.ts" as unknown as SourcePath;
const OPEN_RECORD_NULL_ENTRY = sourcePathOfItem(OPEN_RECORD_PATH, "outro");

const nullableArrayData = createMockData([nullableArrayModule]);
const localeRecordData = createMockData([localeRecordModule]);
const openRecordData = createMockData([openRecordModule]);

// --- Storybook meta ---

const meta: Meta = {
  title: "Fields/Null values",
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="p-8 bg-bg-primary min-h-[200px]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj;

export const NullableArrayList: Story = {
  name: "s.array(s.object().nullable()) — the list",
  render: () => (
    <StoryProviders mockData={nullableArrayData}>
      <div className="max-w-2xl">
        <NavigatedTo path={ARRAY_PATH} />
      </div>
    </StoryProviders>
  ),
};

export const NullableArrayItem: Story = {
  name: "s.array(s.object().nullable()) — a null item, opened",
  render: () => (
    <StoryProviders mockData={nullableArrayData}>
      <div className="grid grid-cols-2 gap-6">
        <Pane title="Item 1 (null) — as the module editor opens it">
          <NavigatedTo path={ARRAY_NULL_ITEM} />
        </Pane>
        <Pane title="Item 0 (written) — for comparison">
          <NavigatedTo path={ARRAY_WRITTEN_ITEM} compact />
        </Pane>
      </div>
    </StoryProviders>
  ),
};

export const NullableArrayItemInsideAField: Story = {
  name: "s.array(s.object().nullable()) — a null item, as a row",
  render: () => (
    <StoryProviders mockData={nullableArrayData}>
      <div className="grid grid-cols-2 gap-6">
        <Pane title="Wrapped in Field — the checkbox affordance">
          <InsideAField path={ARRAY_NULL_ITEM} label="1" />
        </Pane>
        <Pane title="No wrapper — the create state">
          <NavigatedTo path={ARRAY_NULL_ITEM} />
        </Pane>
      </div>
    </StoryProviders>
  ),
};

export const LocaleRecordNullEntry: Story = {
  name: "s.record(s.locale(), …) — an unwritten language",
  render: () => (
    <StoryProviders mockData={localeRecordData}>
      <div className="grid grid-cols-2 gap-6">
        <Pane title="The record — nb-NO reads as untranslated">
          <NavigatedTo path={RECORD_PATH} />
        </Pane>
        <Pane title="The nb-NO entry, opened">
          <NavigatedTo path={RECORD_NULL_ENTRY} />
        </Pane>
      </div>
    </StoryProviders>
  ),
};

export const OpenRecordNullEntry: Story = {
  name: "s.record(s.string(), …) — a null entry is just empty",
  render: () => (
    <StoryProviders mockData={openRecordData}>
      <div className="grid grid-cols-2 gap-6">
        <Pane title="The record — outro is <empty>, not untranslated">
          <NavigatedTo path={OPEN_RECORD_PATH} />
        </Pane>
        <Pane title="The outro entry, opened">
          <NavigatedTo path={OPEN_RECORD_NULL_ENTRY} />
        </Pane>
      </div>
    </StoryProviders>
  ),
};

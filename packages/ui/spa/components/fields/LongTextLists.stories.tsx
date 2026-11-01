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
import { createStorySystem } from "../../stores/react/storySystem";
import { ValSystemProvider } from "../../stores/react/SystemContext";
import { ValThemeProvider, Themes } from "../ValThemeProvider";
import { ValErrorProvider } from "../ValErrorProvider";
import { ValPortalProvider } from "../ValPortalProvider";
import {
  ValFieldProvider,
  useSchemaAtPath,
  useSourceAtPath,
} from "../ValFieldProvider";
import { EllipsisVertical, GripVertical } from "lucide-react";
import { fixCapitalization } from "../../utils/fixCapitalization";
import { ValRouter } from "../ValRouter";
import { TooltipProvider } from "../designSystem/tooltip";

/**
 * Arrays and records whose items carry LONG text, opened the way the module
 * editor opens them: the list of cards you click through to.
 *
 * Two things go wrong with long text here, and these stories exist so they can
 * be seen before they are fixed:
 *
 * 1. A card grows wider than the pane, so the menu on its right (the "⋮" on an
 *    array row, the badge / error indicator on a record card) is pushed out of
 *    view. The dashed outline is the edge of the pane.
 * 2. A card grows taller than a card in a list should be — a wall of text per
 *    row, rather than a row you scan.
 *
 * Same harness as NullValues.stories.tsx: real modules built with initVal,
 * serialized and previewed the way the app does it.
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

type UploadSettingsGetter = React.ComponentProps<
  typeof ValFieldProvider
>["getDirectFileUploadSettings"];

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
  const getDirectFileUploadSettings = useMemo<UploadSettingsGetter>(
    () => async () => ({
      status: "success",
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

/** What the module editor renders for a path: the field, with no wrapper. */
function NavigatedTo({ path }: { path: SourcePath }) {
  const schemaAtPath = useSchemaAtPath(path);
  if (schemaAtPath.status !== "success") {
    return <div>Loading…</div>;
  }
  return <AnyField path={path} schema={schemaAtPath.data} />;
}

/**
 * A pane of a fixed width, outlined, with overflow left VISIBLE — so a card
 * that is wider than its pane shows as sticking out past the dashed line
 * instead of being silently clipped.
 */
function Pane({
  title,
  width,
  children,
}: {
  title: string;
  width: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="pb-3 text-sm font-medium text-fg-secondary">
        {title} — {width}px
      </div>
      <div
        className="outline-dashed outline-2 outline-offset-4 outline-fg-brand-primary"
        style={{ width }}
      >
        {children}
      </div>
    </div>
  );
}

// --- Content ---

const LONG_PROSE =
  "Every Friday we ship whatever is ready, and nothing that is not. This paragraph keeps going, because editors write paragraphs: it talks about the release train, about why a Friday release is not as scary as it sounds once the rollback is one click, and about how the team learned that the hard way during the winter of the big migration, when nobody slept for a week.";

const MULTI_PARAGRAPH = [
  "First paragraph. Short.",
  "",
  "Second paragraph, which is longer and wraps over several lines in any reasonably sized pane, because it was pasted in from a document someone wrote somewhere else.",
  "",
  "Third paragraph.",
  "",
  "Fourth paragraph.",
  "",
  "Fifth paragraph — and there could be twenty of them.",
].join("\n");

const LONG_URL =
  "https://www.example.com/a/very/long/path/that/never/breaks/because/it/has/no/spaces/in/it/at/all?utm_source=newsletter&utm_medium=email&utm_campaign=autumn-sale-2026";

const LONG_WORD =
  "Rettighetshaverorganisasjonsforvaltningsselskapsstyremedlemsvalgkomiteen";

// --- Modules ---

const { s, c } = initVal();

/** No `.preview()` — so each card falls back to the generic per-field dump. */
const sectionSchema = s.object({
  heading: s.string(),
  body: s.string().multiline(),
  link: s.string(),
});

const arrayModule = c.define(
  "/content/sections.val.ts",
  s.array(sectionSchema),
  [
    {
      heading: "Short and sweet",
      body: "A body that fits.",
      link: "/about",
    },
    {
      heading: "A long body",
      body: LONG_PROSE,
      link: "/blog/fridays",
    },
    {
      heading: "Several paragraphs",
      body: MULTI_PARAGRAPH,
      link: "/blog/paragraphs",
    },
    {
      heading: "An unbreakable link",
      body: "The link below has no spaces in it.",
      link: LONG_URL,
    },
    {
      heading: LONG_WORD,
      body: "A heading made of one very long (Norwegian) word.",
      link: "/no",
    },
  ],
);
const ARRAY_PATH = "/content/sections.val.ts" as unknown as SourcePath;

/** A plain array of strings — the simplest list there is. */
const stringArrayModule = c.define(
  "/content/quotes.val.ts",
  s.array(s.string().multiline()),
  ["A short quote.", LONG_PROSE, MULTI_PARAGRAPH, LONG_URL],
);
const STRING_ARRAY_PATH = "/content/quotes.val.ts" as unknown as SourcePath;

const recordModule = c.define(
  "/content/fragments.val.ts",
  s.record(sectionSchema),
  {
    intro: {
      heading: "Short and sweet",
      body: "A body that fits.",
      link: "/about",
    },
    "release-notes": {
      heading: "A long body",
      body: LONG_PROSE,
      link: "/blog/fridays",
    },
    paragraphs: {
      heading: "Several paragraphs",
      body: MULTI_PARAGRAPH,
      link: "/blog/paragraphs",
    },
    campaign: {
      heading: "An unbreakable link",
      body: "The link below has no spaces in it.",
      link: LONG_URL,
    },
    [LONG_WORD.toLowerCase()]: {
      heading: LONG_WORD,
      body: "A key and heading made of one very long word.",
      link: "/no",
    },
  },
);
const RECORD_PATH = "/content/fragments.val.ts" as unknown as SourcePath;

/**
 * For contrast: the same items WITH a `.preview()`. These rows truncate to one
 * line each, which is the behaviour the fallback cards do not have.
 */
const previewedArrayModule = c.define(
  "/content/previewed-sections.val.ts",
  s.array(
    sectionSchema.preview(({ val }) => ({
      title: val.heading,
      subtitle: val.body,
    })),
  ),
  [
    { heading: "Short and sweet", body: "A body that fits.", link: "/about" },
    { heading: "A long body", body: LONG_PROSE, link: "/blog/fridays" },
    { heading: LONG_WORD, body: LONG_URL, link: "/no" },
  ],
);
const PREVIEWED_ARRAY_PATH =
  "/content/previewed-sections.val.ts" as unknown as SourcePath;

/** The record half of the contrast: `.preview()` on a record's item. */
const previewedRecordModule = c.define(
  "/content/previewed-fragments.val.ts",
  s.record(
    sectionSchema.preview(({ val }) => ({
      title: val.heading,
      subtitle: val.body,
    })),
  ),
  {
    intro: { heading: "Short and sweet", body: "A body that fits.", link: "/" },
    "release-notes": {
      heading: "A long body",
      body: LONG_PROSE,
      link: "/blog/fridays",
    },
    campaign: { heading: LONG_WORD, body: LONG_URL, link: "/no" },
  },
);
const PREVIEWED_RECORD_PATH =
  "/content/previewed-fragments.val.ts" as unknown as SourcePath;

/**
 * An item the way a real page section looks: more than three fields, one of
 * them rich text. No `.preview()`, so the card lists every field.
 */
const articleSchema = s.object({
  title: s.string(),
  ingress: s.string().multiline(),
  author: s.string(),
  published: s.date(),
  tags: s.array(s.string()),
  body: s.richtext({ bold: true }),
});
const articleArrayModule = c.define(
  "/content/articles.val.ts",
  s.array(articleSchema),
  [
    {
      title: "Fridays",
      ingress: LONG_PROSE,
      author: "Theodor René Carlsen",
      published: "2026-10-30",
      tags: ["release", "process", "culture"],
      body: [
        { tag: "p", children: [LONG_PROSE] },
        { tag: "p", children: ["A second paragraph."] },
      ],
    },
    {
      title: "Short",
      ingress: "Short ingress.",
      author: "Ada",
      published: "2026-10-31",
      tags: [],
      body: [{ tag: "p", children: ["Short body."] }],
    },
  ],
);
const ARTICLE_ARRAY_PATH = "/content/articles.val.ts" as unknown as SourcePath;

/**
 * Fields inside fields: `author: { person: { name } }`, three levels down,
 * beside a nested object with long text and a nested list.
 */
const contributionSchema = s.object({
  title: s.string(),
  author: s.object({
    person: s.object({
      name: s.string(),
      contact: s.object({ email: s.string(), phone: s.string() }),
    }),
    role: s.string(),
  }),
  seo: s.object({ title: s.string(), description: s.string().multiline() }),
  tags: s.array(s.string()),
});
const nestedArrayModule = c.define(
  "/content/contributions.val.ts",
  s.array(contributionSchema),
  [
    {
      title: "Fridays",
      author: {
        person: {
          name: "Fredrik",
          contact: { email: "fredrik@example.com", phone: "+47 900 00 000" },
        },
        role: "Developer",
      },
      seo: { title: "Why we ship on Fridays", description: LONG_PROSE },
      tags: ["release", "process", "culture"],
    },
    {
      title: "Short",
      author: {
        person: {
          name: "Ada Lovelace",
          contact: { email: "ada@example.com", phone: "" },
        },
        role: "Writer",
      },
      seo: { title: "Short", description: "Short." },
      tags: [],
    },
  ],
);
const NESTED_ARRAY_PATH =
  "/content/contributions.val.ts" as unknown as SourcePath;

const arrayData = createMockData([arrayModule]);
const nestedArrayData = createMockData([nestedArrayModule]);
const previewedRecordData = createMockData([previewedRecordModule]);
const articleArrayData = createMockData([articleArrayModule]);
const stringArrayData = createMockData([stringArrayModule]);
const recordData = createMockData([recordModule]);
const previewedArrayData = createMockData([previewedArrayModule]);

// --- Storybook meta ---

const meta: Meta = {
  title: "Fields/Long text in lists",
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="min-h-[200px] bg-bg-primary p-8">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj;

function TwoWidths({
  mockData,
  path,
}: {
  mockData: MockData;
  path: SourcePath;
}) {
  return (
    <StoryProviders mockData={mockData}>
      <div className="flex flex-wrap items-start gap-16">
        <Pane title="Content pane" width={640}>
          <NavigatedTo path={path} />
        </Pane>
        <Pane title="Narrow pane" width={360}>
          <NavigatedTo path={path} />
        </Pane>
      </div>
    </StoryProviders>
  );
}

export const ArrayOfObjects: Story = {
  name: "s.array(s.object()) — no preview",
  render: () => <TwoWidths mockData={arrayData} path={ARRAY_PATH} />,
};

export const ArrayOfStrings: Story = {
  name: "s.array(s.string())",
  render: () => (
    <TwoWidths mockData={stringArrayData} path={STRING_ARRAY_PATH} />
  ),
};

export const RecordOfObjects: Story = {
  name: "s.record(s.object()) — no preview",
  render: () => <TwoWidths mockData={recordData} path={RECORD_PATH} />,
};

export const ArrayWithPreview: Story = {
  name: "s.array(s.object().preview()) — for contrast",
  render: () => (
    <TwoWidths mockData={previewedArrayData} path={PREVIEWED_ARRAY_PATH} />
  ),
};

export const RecordWithPreview: Story = {
  name: "s.record(s.object().preview()) — for contrast",
  render: () => (
    <TwoWidths mockData={previewedRecordData} path={PREVIEWED_RECORD_PATH} />
  ),
};

export const ArrayOfArticles: Story = {
  name: "s.array(s.object()) — many fields and rich text",
  render: () => (
    <TwoWidths mockData={articleArrayData} path={ARTICLE_ARRAY_PATH} />
  ),
};

export const ArrayOfNestedObjects: Story = {
  name: "s.array(s.object({ author: s.object({ person: … }) })) — nested",
  render: () => (
    <TwoWidths mockData={nestedArrayData} path={NESTED_ARRAY_PATH} />
  ),
};

// --- Nested fields: options -------------------------------------------------
//
// Prototypes, drawn from the same source and schema, so the options can be put
// side by side before any of them goes into `ObjectLikePreview`. Each is a
// pure function of (schema, value): what a card would show.

type Line = { label: React.ReactNode; value: React.ReactNode };

const MAX_LINES = 4;

function isObjectSchema(
  schema: SerializedSchema,
): schema is Extract<SerializedSchema, { type: "object" }> {
  return schema.type === "object";
}

function isPlainObject(v: Json): v is { [key: string]: Json } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A leaf as one line of text — what the per-type previews already show. */
function leafText(schema: SerializedSchema, v: Json): string | null {
  if (v === null || v === "") return null;
  if (schema.type === "array" && Array.isArray(v)) {
    return v.length === 0
      ? null
      : `${v.length} item${v.length === 1 ? "" : "s"}`;
  }
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return "…";
}

/** Every leaf under a value, with the path of labels that leads to it. */
function leaves(
  schema: SerializedSchema,
  v: Json,
  labels: string[] = [],
): { labels: string[]; text: string | null }[] {
  if (isObjectSchema(schema) && isPlainObject(v)) {
    return Object.entries(schema.items)
      .filter(([, item]) => !item.hidden)
      .flatMap(([key, item]) =>
        leaves(item, v[key] ?? null, [...labels, fixCapitalization(key)]),
      );
  }
  return [{ labels, text: leafText(schema, v) }];
}

const Muted = ({ children }: { children: React.ReactNode }) => (
  <span className="text-fg-disabled">{children}</span>
);
const Sep = () => <span className="px-1 text-fg-disabled">·</span>;

type Option = {
  key: string;
  title: string;
  lines: (
    schema: Extract<SerializedSchema, { type: "object" }>,
    v: {
      [key: string]: Json;
    },
  ) => Line[];
};

const topLevel = (
  schema: Extract<SerializedSchema, { type: "object" }>,
  v: { [key: string]: Json },
) =>
  Object.entries(schema.items)
    .filter(([, item]) => !item.hidden)
    .map(([key, item]) => ({ key, item, value: v[key] ?? null }));

const OPTIONS: Option[] = [
  {
    key: "A",
    title: "A — Flatten: one line per leaf, labelled with its path",
    lines: (schema, v) =>
      leaves(schema, v).map(({ labels, text }) => ({
        label: labels.map((l, i) =>
          i < labels.length - 1 ? (
            <span key={i}>
              {l}
              <span className="px-0.5">›</span>
            </span>
          ) : (
            <span key={i}>{l}</span>
          ),
        ),
        value: text ?? <Muted>—</Muted>,
      })),
  },
  {
    key: "B",
    title: "B — One line per top-level field, nested values joined with ·",
    lines: (schema, v) =>
      topLevel(schema, v).map(({ key, item, value }) => {
        const texts = leaves(item, value)
          .map((l) => l.text)
          .filter((t): t is string => t !== null);
        return {
          label: fixCapitalization(key),
          value:
            texts.length === 0 ? (
              <Muted>—</Muted>
            ) : (
              texts.map((t, i) => (
                <span key={i}>
                  {i > 0 && <Sep />}
                  {t}
                </span>
              ))
            ),
        };
      }),
  },
  {
    key: "C",
    title: "C — Like B, with the nested labels inline and muted",
    lines: (schema, v) =>
      topLevel(schema, v).map(({ key, item, value }) => {
        const ls = leaves(item, value).filter((l) => l.text !== null);
        return {
          label: fixCapitalization(key),
          value:
            ls.length === 0 ? (
              <Muted>—</Muted>
            ) : (
              ls.map((l, i) => (
                <span key={i}>
                  {i > 0 && <Sep />}
                  {l.labels.length > 0 && (
                    <Muted>{l.labels[l.labels.length - 1]} </Muted>
                  )}
                  {l.text}
                </span>
              ))
            ),
        };
      }),
  },
  {
    key: "D",
    title: "D — One line per top-level field, nested objects summarised",
    lines: (schema, v) =>
      topLevel(schema, v).map(({ key, item, value }) => {
        const ls = leaves(item, value);
        const first = ls.find((l) => l.text !== null);
        const rest = ls.length - 1;
        return {
          label: fixCapitalization(key),
          value: !isObjectSchema(item) ? (
            (first?.text ?? <Muted>—</Muted>)
          ) : (
            <span>
              {first?.text ?? <Muted>—</Muted>}
              {rest > 0 && <Muted>{` +${rest} more`}</Muted>}
            </span>
          ),
        };
      }),
  },
];

/** The card chrome of `SortableItemRow`, around a prototype's lines. */
function PrototypeCard({ lines }: { lines: Line[] }) {
  const overflowing = lines.length > MAX_LINES;
  const shown = overflowing ? lines.slice(0, MAX_LINES - 1) : lines;
  const leftOut = lines.length - shown.length;
  return (
    <div className="flex items-center">
      <GripVertical className="flex-shrink-0 pr-2 text-fg-secondary" />
      <div className="flex-grow min-w-0 p-2 border rounded-lg border-border-primary bg-bg-primary">
        <div className="grid grid-cols-[min-content,minmax(0,1fr)] gap-x-2 gap-y-1 text-xs leading-4 text-left">
          {shown.map((line, i) => (
            <div key={i} className="contents">
              <span className="flex whitespace-nowrap text-fg-disabled">
                {line.label}
              </span>
              <div className="min-w-0 truncate">{line.value}</div>
            </div>
          ))}
          {overflowing && (
            <span className="col-span-2 text-fg-disabled">
              {`+${leftOut} more field${leftOut === 1 ? "" : "s"}`}
            </span>
          )}
        </div>
      </div>
      <EllipsisVertical size={16} className="flex-shrink-0 mx-2" />
    </div>
  );
}

function OptionList({ option, path }: { option: Option; path: SourcePath }) {
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useSourceAtPath(path);
  if (
    schemaAtPath.status !== "success" ||
    schemaAtPath.data.type !== "array" ||
    sourceAtPath.status !== "success" ||
    !Array.isArray(sourceAtPath.data)
  ) {
    return <div>Loading…</div>;
  }
  const item = schemaAtPath.data.item;
  if (!isObjectSchema(item)) {
    return <div>Not an object</div>;
  }
  return (
    <div className="flex flex-col gap-4">
      {sourceAtPath.data.map((v, i) =>
        isPlainObject(v) ? (
          <PrototypeCard key={i} lines={option.lines(item, v)} />
        ) : null,
      )}
    </div>
  );
}

export const NestedOptions: Story = {
  name: "Nested fields — options",
  render: () => (
    <StoryProviders mockData={nestedArrayData}>
      <div className="flex flex-col gap-12">
        {OPTIONS.map((option) => (
          <div key={option.key}>
            <div className="pb-3 text-sm font-medium text-fg-primary">
              {option.title}
            </div>
            <div className="flex flex-wrap items-start gap-16">
              <Pane title="Content pane" width={640}>
                <OptionList option={option} path={NESTED_ARRAY_PATH} />
              </Pane>
              <Pane title="Narrow pane" width={360}>
                <OptionList option={option} path={NESTED_ARRAY_PATH} />
              </Pane>
            </div>
          </div>
        ))}
      </div>
    </StoryProviders>
  ),
};

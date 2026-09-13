import type { Meta, StoryObj } from "@storybook/react";
import type {
  ImageSource,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { ReactNode } from "react";
import { Globe } from "lucide-react";
import { PathHeading, PageUrlStyle } from "./PathHeading";
import { ListPreviewItem } from "./ListPreviewItem";
import { DropdownPreviewRow } from "./DropdownPreviewRow";
import { NodeIcon } from "./NodeIcon";
import { describePath, Description } from "../utils/describePath";
import { placeholderImage } from "./stories/placeholderAssets";

/**
 * # Describing a source path
 *
 * Wherever the studio shows a source path to a human it has to answer three
 * questions: what is this **called**, what **is** it, and what does it **look
 * like**. Today every surface answers them itself, out of the path, and the
 * answers are things like `footer.val.ts`, `hero_2` and `#3` — names an editor
 * has no relationship with.
 *
 * `describePath` is the one answer. It prefers what the schema's
 * `.preview(...)` said and falls back to the key, the index, the route or the
 * file name — so nothing gets worse when a developer has written nothing, and
 * everything gets better the moment they do.
 *
 * Every pair below is the SAME path: on the left what the studio draws today,
 * on the right what it draws once the value's schema carries a preview.
 */
const meta: Meta = {
  title: "Previews/Describing a path",
  parameters: { layout: "padded" },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj;

const heroImage: ImageSource = {
  path: placeholderImage({
    width: 96,
    height: 96,
    bg: "#1e293b",
    fg: "#e2e8f0",
    text: "Val",
  }),
};

const portrait: ImageSource = {
  path: placeholderImage({
    width: 80,
    height: 80,
    bg: "#e2e8f0",
    fg: "#475569",
    text: "FE",
  }),
};

/* ------------------------------------------------------------------ */
/* Today                                                               */
/* ------------------------------------------------------------------ */

/**
 * The module heading exactly as `Module.tsx` draws it today: one line, the
 * last path segment, no subtitle, no image. For a page it is the URL, drawn as
 * a breadcrumb.
 */
function TodayHeading({ text }: { text: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 text-left">
      <div className="flex gap-4 justify-between items-start min-h-6">
        <div className="min-w-0 flex-1">
          <div role="heading" aria-level={1} className="text-2xl leading-tight">
            <span className="truncate block">{text}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A page heading today: the route, segmented, as `UrlPathBreadcrumb` draws it. */
function TodayPageHeading({ url }: { url: string }) {
  return (
    <TodayHeading
      text={
        <span className="font-normal">
          {url
            .split("/")
            .filter(Boolean)
            .map((segment, i) => (
              <span key={i}>
                <span className="text-fg-tertiary">/</span>
                <span>{segment}</span>
              </span>
            ))}
        </span>
      }
    />
  );
}

/**
 * The generic fallback row — what `RefPreview` falls through to when no
 * preview is declared: the raw key or index on one line, and whatever the
 * value happens to contain under it.
 */
function TodayListRow({ label, dump }: { label: string; dump: string }) {
  return (
    <div className="p-2">
      <div className="truncate text-sm">{label}</div>
      <div className="truncate text-xs text-fg-tertiary">{dump}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

function Compare({
  what,
  note,
  today,
  proposed,
}: {
  what: string;
  note?: string;
  today: ReactNode;
  proposed: ReactNode;
}) {
  return (
    <section className="mb-10">
      <h3 className="mb-1 text-sm font-medium text-fg-primary">{what}</h3>
      {note && (
        <p className="mb-3 max-w-2xl text-xs text-fg-tertiary">{note}</p>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel label="Today">{today}</Panel>
        <Panel label="With a preview">{proposed}</Panel>
      </div>
    </section>
  );
}

function Panel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] uppercase tracking-wide text-fg-quaternary">
        {label}
      </div>
      <div className="rounded-lg border border-border-primary bg-bg-primary p-4">
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The headings                                                        */
/* ------------------------------------------------------------------ */

/**
 * The three headings side by side. These are the case the utility was written
 * for: the top of the editor column, which today can only ever be a file name,
 * a key, an index or a route.
 */
export const TheHeading: Story = {
  render: () => (
    <div className="mx-auto max-w-4xl">
      <Compare
        what="A module — /components/footer.val.ts"
        note="Today the heading is the file name and nothing else: `Footer`, from
              `prettifyFilename`. A module root has no container, so its own
              `.preview(...)` is never run — emitting a self preview is the one
              core change this needs."
        today={<TodayHeading text="Footer" />}
        proposed={
          <PathHeading
            description={{
              title: "Footer links",
              subtitle: "4 groups · 14 links",
              image: null,
              url: null,
              origin: {
                title: "preview",
                subtitle: "preview",
                image: "fallback",
              },
            }}
          />
        }
      />
      <Compare
        what='A record entry — /content/authors.val.ts?p="fredrik-ekholdt"'
        note="Today the heading is the key, verbatim. The fallback stays exactly
              that: a key is authored data, so it is never prettified into a
              name nobody can search for."
        today={<TodayHeading text="fredrik-ekholdt" />}
        proposed={
          <PathHeading
            description={{
              title: "Fredrik Ekholdt",
              subtitle: "Founder · 12 posts",
              image: portrait,
              url: null,
              origin: {
                title: "preview",
                subtitle: "preview",
                image: "preview",
              },
            }}
          />
        }
      />
      <Compare
        what='An array item — /app/(main)/page.val.ts?p="sections".2'
        note="Today the heading is `#2`. Nothing about an index says which of six
              near-identical sections you opened."
        today={<TodayHeading text="#2" />}
        proposed={
          <PathHeading
            description={{
              title: "Content is code",
              subtitle: "Feature section",
              image: heroImage,
              url: null,
              origin: {
                title: "preview",
                subtitle: "preview",
                image: "preview",
              },
            }}
          />
        }
      />
    </div>
  ),
};

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

const pageDescription: Description = {
  title: "Building a scalable front-end architecture",
  subtitle: "Fredrik Ekholdt · 1 Jan 2026",
  image: heroImage,
  url: "/blogs/scalable-front-end-architecture",
  origin: { title: "preview", subtitle: "preview", image: "preview" },
};

const URL_STYLES: { style: PageUrlStyle; name: string; tradeoff: string }[] = [
  {
    style: "subtitle",
    name: "1. URL as the subtitle",
    tradeoff:
      "Name leads, URL is the line under it in mono with a globe. Costs the subtitle line — a page cannot show both its URL and its byline here.",
  },
  {
    style: "chip",
    name: "2. URL as a chip beside the title",
    tradeoff:
      "Name leads, URL sits next to it and the subtitle line is still free. Long routes truncate early, and the title and the chip compete for one line.",
  },
  {
    style: "title",
    name: "3. URL stays the title",
    tradeoff:
      "Nothing moves; the preview title becomes the second line. Safest, and the least improvement — the heading still reads as a path.",
  },
  {
    style: "trail",
    name: "4. URL in the scope trail",
    tradeoff:
      "Name leads, URL joins the breadcrumb line that is already there. No new chrome at all, but the URL is then styled like provenance rather than identity.",
  },
];

/**
 * ## Pages: where does the URL go?
 *
 * A page's URL is not a worse name for the page — it is the page's identity.
 * Two drafts both titled "Launch" are told apart by `/blog/launch-2026` and by
 * nothing else, and the URL is what an editor pastes into a browser to check
 * their work. So `describePath` carries `url` SEPARATELY from `title` and
 * `subtitle`, always, whether or not a preview named the page — and the only
 * open question is where the heading puts it.
 *
 * Four options, all four rendered from the same `Description`.
 */
export const PagesUrlOptions: Story = {
  render: () => (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <Panel label="Today">
          <TodayPageHeading url="/blogs/scalable-front-end-architecture" />
        </Panel>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {URL_STYLES.map(({ style, name, tradeoff }) => (
          <div key={style}>
            <div className="mb-1.5 text-[11px] uppercase tracking-wide text-fg-quaternary">
              {name}
            </div>
            <div className="rounded-lg border border-border-primary bg-bg-primary p-4">
              <PathHeading
                description={pageDescription}
                pageUrlStyle={style}
                scope={
                  style === "trail" ? (
                    <span className="text-fg-quaternary">Blogs</span>
                  ) : undefined
                }
              />
            </div>
            <p className="mt-2 text-xs text-fg-tertiary">{tradeoff}</p>
          </div>
        ))}
      </div>
    </div>
  ),
};

/* ------------------------------------------------------------------ */
/* The surfaces that already preview                                   */
/* ------------------------------------------------------------------ */

/**
 * ## The surfaces that already do this
 *
 * List rows, search hits and reference dropdowns already read `.preview(...)`
 * — they are what it was built for. They are here because they each derive
 * their own fallback today, and those fallbacks disagree with each other and
 * with the heading. Routing all of them through `describePath` is what makes
 * the same entry read the same way in all six places.
 */
export const OtherSurfaces: Story = {
  render: () => (
    <div className="mx-auto max-w-4xl">
      <Compare
        what="A list row"
        note="`RefPreview` already picks between these two. The fallback is the
              generic per-type dump."
        today={
          <div className="divide-y divide-border-primary">
            <TodayListRow label="#0" dump="Community, GitHub, Discord" />
            <TodayListRow label="#1" dump="Legal & Pricing, Terms of Se…" />
          </div>
        }
        proposed={
          <div className="divide-y divide-border-primary">
            <ListPreviewItem
              title="Community"
              subtitle="2 links"
              image={undefined}
            />
            <ListPreviewItem
              title="Legal & Pricing"
              subtitle="2 links"
              image={undefined}
            />
          </div>
        }
      />
      <Compare
        what="A search hit"
        note="The path line above the row stays either way — in search, the path
              is how you tell two matches apart. What changes is the row under
              it."
        today={
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-sm text-fg-tertiary">
              <NodeIcon type="object" size={12} />
              <span>fredrik-ekholdt</span>
            </div>
            <TodayListRow
              label="fredrik-ekholdt"
              dump="name: Fredrik Ekholdt, role: Founder…"
            />
          </div>
        }
        proposed={
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-sm text-fg-tertiary">
              <NodeIcon type="object" size={12} />
              <span>fredrik-ekholdt</span>
            </div>
            <ListPreviewItem
              title="Fredrik Ekholdt"
              subtitle="Founder · 12 posts"
              image={portrait}
              size="compact"
            />
          </div>
        }
      />
      <Compare
        what="A reference — s.keyOf(authors)"
        note="The selected value and every row of the dropdown. The fallback is
              the key, which is also what a just-created entry shows until it
              has any content to preview."
        today={
          <div className="flex flex-col gap-2">
            <div className="rounded border border-border-primary px-2 py-1.5 text-sm">
              fredrik-ekholdt
            </div>
            <div className="rounded border border-border-primary px-2 py-1.5 text-sm text-fg-tertiary">
              erik-bakkevig
            </div>
          </div>
        }
        proposed={
          <div className="flex flex-col gap-2">
            <div className="rounded border border-border-primary px-2 py-1.5">
              <DropdownPreviewRow
                title="Fredrik Ekholdt"
                subtitle="Founder"
                image={portrait}
                imageSize="sm"
              />
            </div>
            <div className="rounded border border-border-primary px-2 py-1.5">
              <DropdownPreviewRow
                title="Erik Bakkevig"
                subtitle="Engineer"
                image={null}
                imageSize="sm"
              />
            </div>
          </div>
        }
      />
      <Compare
        what="A page reference — s.keyOf(pages), and the sitemap"
        note="The one place the URL must not be replaced. Both lines, always:
              the name an editor recognises and the route that says which page
              it actually is."
        today={
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 rounded border border-border-primary px-2 py-1.5 text-sm">
              <Globe size={12} className="text-fg-tertiary" />
              /blogs/scalable-front-end-architecture
            </div>
          </div>
        }
        proposed={
          <div className="flex flex-col gap-2">
            <div className="rounded border border-border-primary px-2 py-1.5">
              <DropdownPreviewRow
                title="Building a scalable front-end architecture"
                subtitle="/blogs/scalable-front-end-architecture"
                image={heroImage}
                imageSize="sm"
              />
            </div>
          </div>
        }
      />
    </div>
  ),
};

/* ------------------------------------------------------------------ */
/* The fallbacks                                                       */
/* ------------------------------------------------------------------ */

/**
 * Serialized schemas, written out: the studio gets these off the wire, and a
 * story has no host to serialize a real `s.array(...)` for it. Only the fields
 * `describePath` reads matter — the rest is the shape `SerializedSchema`
 * requires.
 */
const stringSchema: SerializedSchema = {
  type: "string",
  raw: false,
  opt: false,
};
const arraySchema: SerializedSchema = {
  type: "array",
  item: stringSchema,
  opt: false,
};
const recordSchema: SerializedSchema = {
  type: "record",
  item: stringSchema,
  opt: false,
};
const objectSchema: SerializedSchema = {
  type: "object",
  items: { heroTitle: stringSchema },
  opt: false,
};
const routerSchema: SerializedSchema = {
  type: "record",
  item: stringSchema,
  opt: false,
  router: "next-app-router",
};

const FALLBACK_CASES: { what: string; description: Description }[] = [
  {
    what: "Module root",
    description: describePath({
      path: "/components/footer.val.ts" as ModuleFilePath,
      schema: arraySchema,
    }),
  },
  {
    what: "Array item",
    description: describePath({
      path: "/components/footer.val.ts?p=1" as SourcePath,
      parentSchema: arraySchema,
    }),
  },
  {
    what: "Record entry",
    description: describePath({
      path: '/content/authors.val.ts?p="fredrik-ekholdt"' as SourcePath,
      parentSchema: recordSchema,
    }),
  },
  {
    what: "Object property",
    description: describePath({
      path: '/app/page.val.ts?p="heroTitle"' as SourcePath,
      parentSchema: objectSchema,
    }),
  },
  {
    what: "Page (router key)",
    description: describePath({
      path: '/app/blogs/[id]/page.val.ts?p="/blogs/launch"' as SourcePath,
      parentSchema: routerSchema,
    }),
  },
];

/**
 * ## What you get when nobody wrote a preview
 *
 * Run for real through `describePath`, with no preview at all. This is the
 * floor: it is exactly what the studio shows today, which is the point — the
 * utility never makes an un-annotated project worse, it only gives a developer
 * somewhere to improve it from.
 */
export const Fallbacks: Story = {
  render: () => (
    <div className="mx-auto max-w-2xl rounded-lg border border-border-primary bg-bg-primary">
      {FALLBACK_CASES.map(({ what, description }) => (
        <div
          key={what}
          className="flex items-baseline gap-4 border-b border-border-primary p-3 last:border-b-0"
        >
          <div className="w-36 shrink-0 text-xs text-fg-quaternary">{what}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate">{description.title}</div>
            {description.url && (
              <div className="truncate font-mono text-xs text-fg-tertiary">
                url: {description.url}
              </div>
            )}
          </div>
          <div className="shrink-0 text-[11px] uppercase tracking-wide text-fg-quaternary">
            {description.origin.title}
          </div>
        </div>
      ))}
    </div>
  ),
};

import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { AIChat, type ChatMessage } from "../../AIChat";
import { SiteMock } from "../../proposals/stories/SiteMock";
import { Sketchpad } from "../Sketchpad";
import type { SketchBlockType } from "../boxNodeView";
import type { SketchHighlight } from "../highlights";
import type {
  SketchMediaLibrary,
  SketchMediaOption,
} from "../SketchpadMediaPicker";
import {
  buildSketchpadMessage,
  OpenSketchpadContext,
} from "../SketchpadMessageCard";
import { SketchpadWorkspace } from "../SketchpadWorkspace";

/**
 * What the Sketchpad does next, for a look before it is wired into the
 * Studio. Every piece here is the real component, fed with fixtures:
 *
 * - **Route dividers.** A sketchpad is no one page's. `--- /about` starts the
 *   part about a page, so one sketch covers a page and the pages it links
 *   to. Pressing a route shows that page beside the sketch.
 * - **Start from a route.** An empty sketch starts from a page as it is: the
 *   assistant reads it and writes it here, real images and all.
 * - **Block types.** A box's kind is a combobox of the kinds the site's code
 *   renders (read from the schema). Any other word is allowed too.
 * - **Images that exist.** A box picks from the galleries, the images on the
 *   site, and this chat's uploads. Upload goes to the chat first. A box
 *   naming any other file says so, rather than showing a broken image.
 * - **Drag.** Every block has a grip; an image drags from one box to another.
 * - **Highlights.** The assistant marks blocks to explain itself ("these two
 *   need code"), and the person clears them.
 * - **Build.** What the button sends: the sketchpad as a card in the chat,
 *   and a request to change the pages to match it.
 * - Columns share their row equally: the width controls are gone.
 */
const meta: Meta = {
  title: "Components/Sketchpad/Routes, images and Build",
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
  globals: { theme: "light" },
};
export default meta;
type Story = StoryObj;

const media = (path: string) => `/storybook-media/${path}`;

const option = (
  src: string,
  url: string,
  label: string,
  detail?: string,
): SketchMediaOption => ({ src, url, type: "image", label, detail });

const LIBRARY: SketchMediaLibrary = {
  galleries: [
    {
      name: "Brand colours",
      items: [
        option(
          "/public/val/gallery/brand-blue_9e87d.png",
          media("brand-blue_9e87d.png"),
          "Brand blue",
          "Brand colours",
        ),
        option(
          "/public/val/gallery/accent-amber_37f8b.png",
          media("accent-amber_37f8b.png"),
          "Accent amber",
          "Brand colours",
        ),
        option(
          "/public/val/gallery/ink-slate_8154a.png",
          media("ink-slate_8154a.png"),
          "Ink slate",
          "Brand colours",
        ),
      ],
    },
  ],
  site: [
    option(
      "/public/val/images/coat-quay_a627f.webp",
      media("intro-poster_a627f.webp"),
      "The grey wool coat, on the quay",
      "Home › hero",
    ),
    option(
      "/public/val/gallery/ink-slate_8154a.png",
      media("ink-slate_8154a.png"),
      "Ink slate",
      "About › background",
    ),
  ],
  session: [
    option(
      "session:workshop_3f2a.png",
      media("accent-amber_37f8b.png"),
      "workshop.png",
      "Uploaded in this chat",
    ),
  ],
  upload: async (file) =>
    option(
      `session:${file.name}`,
      URL.createObjectURL(file),
      file.name,
      "Uploaded in this chat",
    ),
};

const BLOCK_TYPES: SketchBlockType[] = [
  { kind: "hero", description: "Hero: heading, text and an image" },
  { kind: "features", description: "Features: three columns" },
  { kind: "testimonial", description: "Testimonial" },
  { kind: "team", description: "Team: people with photos" },
  { kind: "article", description: "Article body" },
  { kind: "button", description: "Button" },
  { kind: "newsletter", description: "Newsletter sign-up" },
];

const ROUTES = ["/", "/about", "/journal/[slug]", "/stores"];

const ICONS = `icon hero M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6
icon testimonial M7 8h10M7 12h6M5 4h14v12H9l-4 4z
icon team M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3 20a6 6 0 0 1 12 0 M17 11a3 3 0 1 0 0-6 M21 20a6 6 0 0 0-4-5.7
icon pricing-table M4 5h16v14H4z M4 10h16 M10 5v14
icon button M3 8h18v8H3z M8 12h8`;

const SKETCH = `--- /
# Clothes that outlast the season.
Made in Bergen from wool we can trace to the farm. Repaired free, for as long as you own it.
[hero: The grey wool coat, on the quay](image: /public/val/images/coat-quay_a627f.webp)
row
  col
    [testimonial: Sigrid, eleven winters in the same coat]
  col
    [pricing-table: Repair plans, from free to lifetime]
[button: Book a fitting]
--- /about
## Who makes them
Six tailors and a weaver, in one workshop by the harbour.
[team: The workshop](image: session:workshop_3f2a.png)
--- /journal/[slug]
## A journal post
[article: Long read on traceable wool, with pull quotes]

${ICONS}
`;

/** The page at a route, in a frame with its address, as the preview shows it. */
function RoutePreview({ route }: { route: string }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border-primary px-3 py-2">
        <span className="text-xs font-medium text-fg-secondary">Preview</span>
        <span className="min-w-0 flex-1 truncate rounded-md bg-bg-secondary px-2 py-1 text-xs text-fg-secondary">
          nordic-retail.example{route}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <SiteMock testimonials="none" />
      </div>
    </div>
  );
}

function Workspace({
  initial,
  highlights: initialHighlights = [],
  startRoute = null,
  draft,
  missingImage = false,
}: {
  initial: string;
  highlights?: SketchHighlight[];
  startRoute?: string | null;
  /** What the assistant writes when the sketch is started from a page. */
  draft?: string;
  missingImage?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [route, setRoute] = useState<string>("/");
  const [highlights, setHighlights] = useState(initialHighlights);
  const [drafting, setDrafting] = useState(false);

  // The assistant writing the page it was started from, a few lines at a time.
  useEffect(() => {
    if (!drafting || !draft) return;
    const lines = draft.split("\n");
    let shown = 0;
    const timer = setInterval(() => {
      shown += 2;
      setValue(lines.slice(0, shown).join("\n") + "\n");
      if (shown >= lines.length) {
        setValue(draft);
        setDrafting(false);
      }
    }, 350);
    return () => clearInterval(timer);
  }, [drafting, draft]);

  return (
    <div className="h-screen bg-bg-secondary p-3">
      <SketchpadWorkspace
        preview={<RoutePreview route={route} />}
        sketchpads={{
          sketchpads: [],
          onOpen: () => undefined,
          onReopen: () => undefined,
        }}
        sketchpad={
          <Sketchpad
            value={value}
            onChange={setValue}
            title="Autumn: home, about and the journal"
            status={
              drafting ? "The assistant is writing it…" : "Saved just now"
            }
            readOnly={drafting}
            pageOptions={ROUTES}
            activeRoute={route}
            onOpenRoute={setRoute}
            startRoute={startRoute}
            onStartFromRoute={(from) => {
              setRoute(from);
              setDrafting(true);
            }}
            mediaLibrary={
              missingImage
                ? {
                    ...LIBRARY,
                    site: LIBRARY.site.filter(
                      (o) => !o.src.includes("coat-quay"),
                    ),
                  }
                : LIBRARY
            }
            blockTypes={BLOCK_TYPES}
            highlights={highlights}
            onClearHighlight={(id) =>
              setHighlights((all) =>
                id === null ? [] : all.filter((h) => h.id !== id),
              )
            }
            onAskAssistant={() => undefined}
            assistantStatus="changed"
          />
        }
      />
    </div>
  );
}

/**
 * One sketchpad, three pages. Each `--- /route` divider starts the part
 * about a page; press a route and its page is beside the sketch (the
 * address in the preview follows). "Change" on a divider picks another of
 * the site's routes, and the toolbar's page button adds a divider.
 */
export const RouteDividers: Story = {
  render: () => <Workspace initial={SKETCH} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "/about" }),
    );
    await userEvent.click(
      await canvas.findByRole("menuitem", {
        name: /Show \/about in the preview/,
      }),
    );
    await expect(
      await canvas.findByText("nordic-retail.example/about"),
    ).toBeInTheDocument();
  },
};

/**
 * An empty sketchpad, opened from the about page in the Pages menu: it
 * offers that page first. The assistant reads the page and writes it here
 * (simulated, a few lines at a time), with the page's own images.
 */
export const StartFromARoute: Story = {
  render: () => (
    <Workspace
      initial=""
      startRoute="/about"
      draft={`--- /about
## Who makes them
Six tailors and a weaver, in one workshop by the harbour.
[team: The workshop](image: /public/val/gallery/ink-slate_8154a.png)
row
  col
    ### Since 1987
    Three generations at the same benches.
  col
    ### Repairs
    Bring any coat back, any year.
[button: Visit the workshop]

${ICONS}
`}
    />
  ),
};

/**
 * Block types. Press a box's kind to change it: the field suggests the
 * site's kinds, and takes any other word too.
 */
export const BlockTypes: Story = {
  render: () => <Workspace initial={SKETCH} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "pricing-table" }),
    );
    const input = await canvas.findByRole("combobox", { name: "Kind of box" });
    const list = canvasElement.querySelector(
      `datalist#${input.getAttribute("list")}`,
    );
    await expect(list?.querySelector('option[value="hero"]')).toBeTruthy();
  },
};

/**
 * The image picker, from a box's image button: the galleries, the images on
 * the site (with where each one is), and this chat's uploads. Upload puts a
 * file in the chat first, then in the box.
 */
export const PickAnImage: Story = {
  render: () => <Workspace initial={SKETCH} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const buttons = await canvas.findAllByRole("button", {
      name: "Change the image or video",
    });
    await userEvent.click(buttons[0]);
    await expect(
      await within(document.body).findByRole("dialog", {
        name: "Pick an image",
      }),
    ).toBeInTheDocument();
  },
};

/**
 * A box naming an image the project does not have -- a guessed path, or one
 * deleted since -- says so, and offers the picker, instead of a broken image.
 */
export const AnImageThatIsNotThere: Story = {
  render: () => <Workspace initial={SKETCH} missingImage />,
};

/**
 * The assistant explains itself: asked why Build wants code, it marks the
 * blocks that need a kind the site does not have. The person clears it.
 */
export const HighlightedByTheAssistant: Story = {
  render: () => (
    <Workspace
      initial={SKETCH}
      highlights={[
        {
          id: "needs-code",
          lines: [9],
          color: "amber",
          note: "Needs code: the site has no pricing table yet",
        },
        {
          id: "upload",
          lines: [14],
          color: "blue",
          note: "From this chat: added to the site when it is built",
        },
      ]}
    />
  ),
};

const BUILD_MESSAGES: ChatMessage[] = [
  {
    id: "build",
    role: "user",
    status: "complete",
    content: buildSketchpadMessage({
      id: "1fd712f4-4b61-4cb7-a0d7-8601ed2a8171",
      title: "Autumn: home, about and the journal",
      routes: ["/", "/about", "/journal/[slug]"],
    }),
  },
  {
    id: "answer",
    role: "assistant",
    status: "complete",
    content:
      "I've built the sketch on **/** and **/about**: the hero text and image, the testimonial, and the team photo, which I added to the gallery first.\n\nOne block needs code: **pricing-table** isn't a section the site has. I've marked it in the sketchpad. Shall I leave it out, or should someone add the section?",
  },
];

/**
 * What Build sends: the sketchpad as a card (press it to open the
 * sketchpad), then the request -- to change the pages to match the sketch,
 * not to comment on it.
 */
export const BuildInTheChat: Story = {
  render: () => (
    <OpenSketchpadContext.Provider value={() => undefined}>
      <div className="mx-auto flex h-screen max-w-md flex-col border-x border-border-primary bg-bg-primary">
        <AIChat
          isConnected
          authError={false}
          mode="http"
          onSendMessage={() => true}
          initialMessages={BUILD_MESSAGES}
        />
      </div>
    </OpenSketchpadContext.Provider>
  ),
};

/**
 * A route divider's menu, open: show the page, change it, or remove it.
 * The field finds a page of the site, or takes a new one: typed here,
 * "/sustainability" is not a page yet, and is offered as a new page.
 */
export const RouteMenuOpen: Story = {
  render: () => <Workspace initial={SKETCH} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "/about" }),
    );
    await expect(
      await canvas.findByRole("menu", { name: "Route /about" }),
    ).toBeInTheDocument();
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Find a page, or type a new one" }),
      "sustainability",
    );
    await expect(
      await canvas.findByRole("menuitem", {
        name: /New page \/sustainability/,
      }),
    ).toBeInTheDocument();
  },
};

/**
 * A new page of a type the site has: "New /journal/[slug] page" asks for the
 * slug alone, with the route's fixed parts already there, so the page is one
 * the site can render. (Typed instead, any other route is offered too.)
 */
export const NewPageOfAType: Story = {
  render: () => <Workspace initial={SKETCH} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "/about" }),
    );
    await userEvent.click(
      await canvas.findByRole("menuitem", {
        name: /New \/journal\/\[slug\] page/,
      }),
    );
    await userEvent.type(
      await canvas.findByRole("textbox", { name: "slug" }),
      "Traceable wool",
    );
    await expect(
      await canvas.findByRole("button", {
        name: /Add \/journal\/Traceable-wool/,
      }),
    ).toBeInTheDocument();
  },
};

const NARROW = `--- /
# Four columns
row
  col
    ### Opening hours
    Monday to Friday, ten to six.
    [opening-hours-table: Hours]
  col
    ### Find us
    [store-locator-map: Map of the stores]
    [hero: Autumn](image: /public/val/gallery/accent-amber_37f8b.png)
    [hero: Gone](image: /public/val/not-in-the-project.png)
  col
    ### Repairs
    Bring any coat back, any year.
    [testimonial: A customer]
  col
    ### Newsletter
    [newsletter: Sign up]
    [loyalty-programme-signup: Join]

${ICONS}
`;

/**
 * Four columns side by side, as narrow as a sketch's columns get: every
 * block in them has to keep its shape, the box headers included.
 */
export const NarrowColumns: Story = {
  render: function Render() {
    const [value, setValue] = useState(NARROW);
    return (
      <div className="h-screen bg-bg-secondary p-3">
        <div className="mx-auto h-full max-w-[760px]">
          <Sketchpad
            value={value}
            onChange={setValue}
            title="Four columns"
            status="Saved just now"
            pageOptions={ROUTES}
            activeRoute="/"
            mediaLibrary={LIBRARY}
            blockTypes={BLOCK_TYPES}
            onAskAssistant={() => undefined}
            assistantStatus="changed"
          />
        </div>
      </div>
    );
  },
};

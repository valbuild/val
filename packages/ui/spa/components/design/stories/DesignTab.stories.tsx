import type { Meta, StoryObj } from "@storybook/react";
import { AIChat, type ChatMessage } from "../../AIChat";
import { changedFiles } from "../../../design/changedFiles";
import { lineDiff } from "../../../design/lineDiff";
import { DesignSiteMock } from "./DesignSiteMock";
import {
  DesignTabView,
  type DesignCheckpoint,
  type DesignTabViewProps,
} from "../DesignTabView";

/**
 * The design tab (valbuild/home `docs/design-tab.md`): a proposal's code,
 * changed by the assistant and previewed, in a tab served by the SITE's
 * build, so the tab, the assistant and its tools stay up when the proposal's
 * code breaks. The frame in the middle is the proposal's own address;
 * everything around it is the site's.
 *
 * - **Working** -- the assistant added a section; it built and rendered.
 * - **Building** -- a change is building; the frame shows the last build.
 * - **Build not served** -- the build did not render, so the address kept
 *   the last one that did (step 1), and the frame still shows it. The two
 *   ways on: the assistant fixes it, or build again.
 * - **Changes** -- a file against the site's copy.
 * - **Nothing changed yet** -- a proposal that runs the site's code.
 * - **Safari** -- the bundler cannot run in a tab that frames the site, so
 *   the build waits for a builder window opened from a tap.
 */
const meta: Meta<typeof DesignTabView> = {
  title: "Design/DesignTab",
  component: DesignTabView,
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
};
export default meta;
type Story = StoryObj<typeof DesignTabView>;

const SITE: Record<string, string> = {
  "src/routes/_site.index.tsx": [
    'import { Hero } from "../components/sections/Hero";',
    'import { Quote } from "../components/sections/Quote";',
    'import { ProductGrid } from "../components/sections/ProductGrid";',
    "",
    "function Home() {",
    "  const page = useValRoute(homeVal);",
    "  return (",
    "    <>",
    "      <Hero {...page.hero} />",
    "      <Quote {...page.quote} />",
    "      <ProductGrid {...page.products} />",
    "    </>",
    "  );",
    "}",
    "",
  ].join("\n"),
  "src/components/sections/Quote.tsx":
    "export function Quote() {\n  return null;\n}\n",
  "src/routes/_site.index.val.ts": "export default c.define(/* … */);\n",
};

const PROPOSAL: Record<string, string | null> = {
  "src/routes/_site.index.tsx": SITE["src/routes/_site.index.tsx"]
    .replace(
      'import { Quote } from "../components/sections/Quote";',
      'import { Testimonials } from "../components/sections/Testimonials";',
    )
    .replace(
      "      <Quote {...page.quote} />",
      "      <Testimonials items={page.testimonials} />",
    ),
  "src/components/sections/Quote.tsx": null,
  "src/components/sections/Testimonials.tsx": [
    "export function Testimonials({ items }: { items: Testimonial[] }) {",
    "  return (",
    '    <section className="bg-subtle px-8 py-12">',
    '      <h2 className="mb-6 text-2xl font-bold">Worn for years, not weeks</h2>',
    "      {items.map((item) => <Card key={item.name} {...item} />)}",
    "    </section>",
    "  );",
    "}",
    "",
  ].join("\n"),
  "src/routes/_site.index.val.ts":
    "export default c.define(/* …, testimonials */);\n",
};

const FILES = changedFiles(SITE, PROPOSAL, [
  "src/routes/_site.index.tsx",
  "src/components/sections/Quote.tsx",
  "src/components/sections/Testimonials.tsx",
]);

const CHECKPOINTS: DesignCheckpoint[] = [
  {
    id: "c5",
    message: "Testimonials as cards, three across",
    ago: "2 minutes ago",
    current: true,
  },
  { id: "c4", message: "Testimonials on the front page", ago: "6 minutes ago" },
  {
    id: "c3",
    message: "Testimonials schema: quote, name, place",
    ago: "8 minutes ago",
  },
  {
    id: "c2",
    message: "Remove the unused Quote section",
    ago: "9 minutes ago",
  },
];

const MESSAGES: ChatMessage[] = [
  {
    id: "u1",
    role: "user",
    content:
      "Replace the quote on the front page with a section of customer testimonials. Three of them, as cards.",
    status: "complete",
  },
  {
    id: "a1",
    role: "assistant",
    content:
      "Done, and it is in the preview. I added a **Testimonials** section with its own schema (quote, name, place), put it on the front page where the quote was, and removed the Quote section, which nothing else used.\n\n" +
      "Nothing on the site has changed: it changes when the proposal is published.",
    status: "complete",
    toolActivities: [
      { toolCallId: "t1", name: "list_files", status: "complete" },
      { toolCallId: "t2", name: "read_file", status: "complete" },
      { toolCallId: "t3", name: "write_files", status: "complete" },
      { toolCallId: "t4", name: "build_proposal", status: "complete" },
    ],
  },
];

const chat = (messages: ChatMessage[]) => (
  <AIChat
    className="h-full"
    initialMessages={messages}
    isConnected
    authError={false}
    mode="http"
    onSendMessage={() => true}
  />
);

const BASE: DesignTabViewProps = {
  proposal: {
    displayName: "Front page testimonials",
    address: "https://3f9c1e7a2b4d6c8e0a1b--nordic.valstart.dev",
  },
  studioUrl: "https://3f9c1e7a2b4d6c8e0a1b--nordic.valstart.dev/val",
  previewHref: "https://3f9c1e7a2b4d6c8e0a1b--nordic.valstart.dev/",
  route: "/",
  onRouteChange: () => {},
  onReload: () => {},
  files: FILES,
  diffOf: (path) => lineDiff(SITE[path] ?? null, PROPOSAL[path] ?? null),
  checkpoints: CHECKPOINTS,
  checks: [
    { label: "Types", check: { state: "passed" } },
    { label: "Build", check: { state: "passed", detail: "renders" } },
  ],
  build: { required: false, building: false, progress: null, onBuild: null },
  builder: { kind: "in-tab" },
  problem: null,
  preview: <DesignSiteMock testimonials="cards" />,
  chat: chat(MESSAGES),
};

export const Working: Story = { args: BASE };

export const Building: Story = {
  args: {
    ...BASE,
    checks: [
      { label: "Types", check: { state: "passed" } },
      { label: "Build", check: { state: "running", percent: 62 } },
    ],
    build: {
      required: true,
      building: true,
      progress: { label: "Building the project", percent: 62 },
      onBuild: () => {},
    },
    preview: <DesignSiteMock testimonials="quote" />,
    chat: chat([
      MESSAGES[0],
      {
        id: "a1",
        role: "assistant",
        content:
          "I have written the section and its schema. Building it now, so the preview shows it.",
        status: "streaming",
        toolActivities: [
          { toolCallId: "t3", name: "write_files", status: "complete" },
          { toolCallId: "t4", name: "build_proposal", status: "pending" },
        ],
      },
    ]),
  },
};

const NOT_RENDERED =
  "The build does not render, so the proposal's address still serves its last build. The page answered 200, but its render failed: TypeError: Cannot read properties of undefined (reading 'map')";

export const BuildNotServed: Story = {
  name: "Build not served",
  args: {
    ...BASE,
    checks: [
      { label: "Types", check: { state: "passed" } },
      { label: "Build", check: { state: "failed", message: NOT_RENDERED } },
    ],
    build: {
      required: true,
      building: false,
      progress: null,
      onBuild: () => {},
    },
    problem: {
      title: "The build was not served",
      message:
        "The preview still shows the last build that worked. Ask the assistant to fix what the build says below, or build again.",
      details: NOT_RENDERED,
      onAskAssistant: () => {},
      action: { label: "Build again", onClick: () => {} },
    },
    chat: chat([
      ...MESSAGES,
      {
        id: "u2",
        role: "user",
        content:
          "Can the testimonials come from one list we reuse on every page?",
        status: "complete",
      },
      {
        id: "a2",
        role: "assistant",
        content:
          "I moved them into a module of their own, but the build was not served: the front page does not render, because the section gets no items. Should I fix it?",
        status: "complete",
        toolActivities: [
          { toolCallId: "t7", name: "write_files", status: "complete" },
          { toolCallId: "t8", name: "build_proposal", status: "error" },
        ],
      },
    ]),
  },
};

export const Changes: Story = {
  args: { ...BASE, initialView: "changes" },
};

export const NothingChangedYet: Story = {
  name: "Nothing changed yet",
  args: {
    ...BASE,
    files: [],
    checkpoints: [],
    checks: [
      { label: "Build", check: { state: "idle", detail: "the site's code" } },
    ],
    preview: <DesignSiteMock testimonials="none" />,
    chat: chat([]),
  },
};

export const Phone: Story = {
  args: { ...BASE, initialDevice: "mobile" },
};

export const SafariNoBuilderWindow: Story = {
  name: "Safari: no builder window",
  args: {
    ...BASE,
    builder: { kind: "window", blocked: true },
    onOpenBuilder: () => {},
    checks: [{ label: "Build", check: { state: "running", percent: null } }],
    build: {
      required: true,
      building: true,
      progress: { label: "Waiting for the builder tab", percent: null },
      onBuild: () => {},
    },
    preview: <DesignSiteMock testimonials="none" />,
  },
};

import type { Meta, StoryObj } from "@storybook/react";
import type { ChatMessage } from "../../AIChat";
import { DesignSiteMock } from "./DesignSiteMock";
import {
  DesignTabMock,
  type DesignCheckpoint,
  type DesignDiffLine,
  type DesignFile,
  type DesignTabProps,
} from "./DesignTabMock";

/**
 * The design tab: a sketch, not a component the Studio has.
 *
 * A proposal's code is changed by the assistant and previewed in a tab served
 * by the SITE's build, so the tab, the assistant and the file tools stay up
 * when the proposal's code breaks. The frame in the middle is the proposal's
 * own address; everything around it is the site's.
 *
 * - **Working** -- the assistant added a section, it built and rendered.
 * - **Building** -- a change is building; the frame shows the last build.
 * - **Broken** -- the last build does not render. The site is untouched, and
 *   the tab offers the two ways out: the assistant fixes it, or go back to the
 *   last checkpoint that rendered.
 * - **Changes** -- the diff of a file against the site.
 * - **Safari** -- the bundler cannot run in a tab that frames the site, so
 *   builds go to a builder window, opened once.
 */
const meta: Meta<typeof DesignTabMock> = {
  title: "Proposals/DesignTab",
  component: DesignTabMock,
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
};
export default meta;
type Story = StoryObj<typeof DesignTabMock>;

const FILES: DesignFile[] = [
  { path: "src/components/sections/Testimonials.tsx", change: "added" },
  { path: "src/components/sections/Testimonials.val.ts", change: "added" },
  { path: "src/routes/_site.index.tsx", change: "modified" },
  { path: "src/routes/_site.index.val.ts", change: "modified" },
  { path: "src/components/sections/Quote.tsx", change: "deleted" },
];

const CHECKPOINTS: DesignCheckpoint[] = [
  {
    id: "c5",
    message: "Testimonials as cards, three across",
    ago: "2 min ago",
    rendered: true,
    current: true,
  },
  {
    id: "c4",
    message: "Add testimonials section to the front page",
    ago: "6 min ago",
    rendered: true,
  },
  {
    id: "c3",
    message: "Testimonials schema: quote, name, place",
    ago: "8 min ago",
    rendered: true,
  },
  {
    id: "c2",
    message: "Remove the unused Quote section",
    ago: "9 min ago",
    rendered: true,
  },
];

const DIFF: DesignDiffLine[] = [
  {
    kind: "context",
    text: 'import { Hero } from "../components/sections/Hero";',
  },
  {
    kind: "context",
    text: 'import { ProductGrid } from "../components/sections/ProductGrid";',
  },
  {
    kind: "added",
    text: 'import { Testimonials } from "../components/sections/Testimonials";',
  },
  { kind: "context", text: "" },
  { kind: "context", text: "function Home() {" },
  { kind: "context", text: "  const page = useValRoute(homeVal);" },
  { kind: "context", text: "  return (" },
  { kind: "context", text: "    <>" },
  { kind: "context", text: "      <Hero {...page.hero} />" },
  { kind: "removed", text: "      <Quote {...page.quote} />" },
  {
    kind: "added",
    text: "      <Testimonials items={page.testimonials} />",
  },
  { kind: "context", text: "      <ProductGrid {...page.products} />" },
  { kind: "context", text: "    </>" },
  { kind: "context", text: "  );" },
  { kind: "context", text: "}" },
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
      "The three testimonials are content, so you can change them in the Studio. Nothing on the site has changed: it changes when the proposal is published.",
    status: "complete",
    toolActivities: [
      { toolCallId: "t1", name: "list_files", status: "complete" },
      { toolCallId: "t2", name: "read_file", status: "complete" },
      { toolCallId: "t3", name: "write_files", status: "complete" },
      { toolCallId: "t4", name: "typecheck_proposal", status: "complete" },
      { toolCallId: "t5", name: "build_proposal", status: "complete" },
      { toolCallId: "t6", name: "check_render", status: "complete" },
    ],
  },
];

const BASE: DesignTabProps = {
  proposal: {
    displayName: "Front page testimonials",
    address: "https://3f9c1e7a2b4d6c8e0a1b--nordic.valstart.dev",
  },
  route: "/",
  files: FILES,
  checkpoints: CHECKPOINTS,
  checks: {
    typecheck: { state: "passed" },
    build: { state: "passed", detail: "3.1 s" },
    render: { state: "passed" },
  },
  builder: { kind: "in-tab" },
  preview: { state: "live" },
  site: <DesignSiteMock testimonials="cards" />,
  diff: DIFF,
  selectedFile: "src/routes/_site.index.tsx",
  messages: MESSAGES,
};

export const Working: Story = { args: BASE };

export const Building: Story = {
  args: {
    ...BASE,
    files: FILES.map((file) =>
      file.path === "src/components/sections/Testimonials.tsx"
        ? { ...file, unstaged: true }
        : file,
    ),
    checks: {
      typecheck: { state: "passed" },
      build: { state: "running", progress: 62 },
      render: { state: "idle" },
    },
    preview: { state: "building", progress: 62 },
    site: <DesignSiteMock testimonials="quote" />,
    messages: [
      ...MESSAGES.slice(0, 1),
      {
        id: "a1",
        role: "assistant",
        content:
          "I have written the section and its schema. Building it now, so the preview shows it.",
        status: "streaming",
        toolActivities: [
          { toolCallId: "t1", name: "list_files", status: "complete" },
          { toolCallId: "t2", name: "read_file", status: "complete" },
          { toolCallId: "t3", name: "write_files", status: "complete" },
          {
            toolCallId: "t4",
            name: "typecheck_proposal",
            status: "complete",
          },
          { toolCallId: "t5", name: "build_proposal", status: "pending" },
        ],
      },
    ],
  },
};

export const Broken: Story = {
  args: {
    ...BASE,
    checks: {
      typecheck: { state: "passed" },
      build: { state: "passed", detail: "2.8 s" },
      render: {
        state: "failed",
        message:
          "TypeError: Cannot read properties of undefined (reading 'map')",
      },
    },
    checkpoints: [
      {
        id: "c6",
        message: "Load testimonials from a module of their own",
        ago: "just now",
        rendered: false,
        current: true,
      },
      ...CHECKPOINTS.map((checkpoint) => ({
        ...checkpoint,
        current: false,
      })),
    ],
    preview: {
      state: "broken",
      message:
        "The front page threw an error while rendering: the Testimonials section was given no items.",
      details:
        "TypeError: Cannot read properties of undefined (reading 'map')\n" +
        "    at Testimonials (src/components/sections/Testimonials.tsx:14:22)\n" +
        "    at Home (src/routes/_site.index.tsx:11:7)\n" +
        "    at renderToReadableStream (vendor/react-dom-server.js)\n\n" +
        "Rendered at https://3f9c1e7a2b4d6c8e0a1b--nordic.valstart.dev/ by the render check, build 9e41c0d.",
      lastWorking: CHECKPOINTS[0],
    },
    messages: [
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
          "I moved them into a module of their own and pointed the front page at it, but the page no longer renders: the section gets no items. Should I fix it, or go back to the cards that worked?",
        status: "complete",
        toolActivities: [
          { toolCallId: "t7", name: "write_files", status: "complete" },
          { toolCallId: "t8", name: "build_proposal", status: "complete" },
          { toolCallId: "t9", name: "check_render", status: "error" },
        ],
      },
    ],
  },
};

export const Changes: Story = {
  args: { ...BASE, initialView: "changes" },
};

export const Phone: Story = {
  args: { ...BASE, initialDevice: "mobile" },
};

export const SafariNoBuilderWindow: Story = {
  name: "Safari: no builder window",
  args: {
    ...BASE,
    builder: { kind: "window", connected: false },
    checks: {
      typecheck: { state: "passed" },
      build: { state: "idle" },
      render: { state: "idle" },
    },
    site: <DesignSiteMock testimonials="none" />,
    messages: [
      MESSAGES[0],
      {
        id: "a1",
        role: "assistant",
        content:
          "The section is written and typechecks. To show it in the preview I need to build it, and in Safari that happens in a builder window. Open it with the button at the top, and I will build.",
        status: "complete",
        toolActivities: [
          { toolCallId: "t3", name: "write_files", status: "complete" },
          {
            toolCallId: "t4",
            name: "typecheck_proposal",
            status: "complete",
          },
          { toolCallId: "t5", name: "build_proposal", status: "error" },
        ],
      },
    ],
  },
};

export const SafariBuilderWindowOpen: Story = {
  name: "Safari: builder window open",
  args: { ...BASE, builder: { kind: "window", connected: true } },
};

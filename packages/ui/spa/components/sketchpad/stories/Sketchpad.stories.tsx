import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import { Sketchpad, type SketchpadProps } from "../Sketchpad";

/**
 * Sketchpad: a page's content and rough layout, worked out with the
 * assistant before anyone builds it. It lives outside the chat, so both sides
 * can change it: the assistant rewrites it, the editor types in it.
 *
 * The page is a document: click anywhere and type, and the caret moves
 * through headings, paragraphs, box labels and columns with the arrow keys.
 * `#` makes a heading and `[kind: label]` a box, as in the text; the toolbar
 * adds boxes and columns. Drop an image or a video on a box to put it in.
 * Click a box's kind to rename it.
 *
 * The assistant reads and writes the same page as text, in one strict form
 * (see `sketchFormat.ts`):
 *
 * ```
 * # Heading / ## Sub / ### Small     text
 * Any other line                     text (a paragraph)
 * [image: Team photo]                a box: [kind] or [kind: label]
 * row                                its children side by side
 *   col 2                            its children stacked; 2 shares of a row
 * [hero: Roof](image: /roof.jpg)     a box with an image (or video) in it
 *
 * icon stat M3 17l6-6 4 4 8-8        how every [stat] box is drawn
 * ```
 *
 * A box's kind is any word. The assistant draws each kind's icon as SVG path
 * data, so the sketch is not limited to the kinds someone gave icons to.
 */
const meta: Meta<typeof Sketchpad> = {
  title: "Components/Sketchpad",
  component: Sketchpad,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="h-[720px] bg-bg-primary p-4">
        <Story />
      </div>
    ),
  ],
  render: (args) => <Editable {...args} />,
};
export default meta;
type Story = StoryObj<typeof Sketchpad>;

/** Keeps the story's text in state, so typing in it works. */
function Editable(props: SketchpadProps) {
  const [value, setValue] = useState(props.value);
  useEffect(() => setValue(props.value), [props.value]);
  return <Sketchpad {...props} value={value} onChange={setValue} />;
}

/**
 * Icons the way an assistant writes them: path data for a 24 by 24 line
 * icon. Hand-written here; in use they come from the same call that writes
 * the sketch, so a new kind of box arrives with its icon.
 */
const ICONS: Record<string, string> = {
  image: "M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6 M15.5 8.5h.01",
  video: "M3 6h13v12H3z M16 10l5-3v10l-5-3z",
  button: "M3 8h18v8H3z M8 12h8",
  link: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1 M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
  input: "M3 7h18v10H3z M7 10v4",
  form: "M4 3h16v18H4z M8 8h8 M8 12h8 M8 16h4",
  list: "M8 6h13 M8 12h13 M8 18h13 M3.5 6h.01 M3.5 12h.01 M3.5 18h.01",
  map: "M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z M12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  stat: "M3 17l6-6 4 4 8-8 M15 7h6v6",
  chart: "M4 20V10 M10 20V4 M16 20v-7 M3 20h18",
  table: "M3 5h18v14H3z M3 10h18 M3 15h18 M9 5v14",
  testimonial: "M4 17h4l2-4V7H4v6h3 M13 17h4l2-4V7h-6v6h3",
  pricing: "M3 12V4h8l10 10-8 8z M7.5 7.5h.01",
  logos:
    "M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M17 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  newsletter: "M3 6h18v12H3z M3 6l9 7 9-7",
  faq: "M9 9a3 3 0 1 1 4 2.8c-.6.3-1 .9-1 1.6V15 M12 18h.01",
  countdown: "M12 8v4l3 2 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M9 2h6",
};

/** The icon lines for `kinds`, as they would close a sketch. */
function icons(...kinds: string[]): string {
  return kinds.map((kind) => `icon ${kind} ${ICONS[kind]}`).join("\n");
}

const LANDING = `# Build better websites, together
Val lets your editors change content without waiting for a developer.
row
  [button: Start for free]
  [button: Book a demo]
[image: Screenshot of the Studio editing a page]
row
  col
    ### Edit in place
    Click any text on your site and change it.
  col
    ### Content in git
    Every change is a commit you can review.
  col
    ### Type safe
    Your schema is TypeScript, checked at build time.
## What our customers say
row
  col
    [image: Portrait of Kari]
  col 3
    "We stopped sending Word documents to our developers."
    Kari Nordmann, head of marketing

${icons("button", "image")}
`;

const ARTICLE = `row
  col 3
    # How we moved our CMS into git
    By Ola Nordmann, 12 March
    [image: The team at the whiteboard]
    For years our content lived in a database that nobody could review.
    ## The first attempt
    We started by exporting everything to JSON files.
    [video: Demo of the migration script]
    ## What we learned
    Content is code, and should be treated like it.
  col
    ### About the author
    [image: Portrait of Ola]
    Ola writes about developer tooling.
    ### Related posts
    [list: Three related posts]
    [button: Subscribe]

${icons("image", "video", "list", "button")}
`;

export const Empty: Story = {
  args: { value: "", title: "/about" },
};

export const LandingPage: Story = {
  args: { value: LANDING, title: "/" },
};

/** A wide column and a sidebar: `col 3` takes three shares of the row. */
export const ArticleWithSidebar: Story = {
  args: { value: ARTICLE, title: "/blog/cms-in-git" },
};

/**
 * A dashboard is the same four primitives: a row of stat tiles, charts side
 * by side, and a table. A placeholder's kind is free text, so `stat`, `chart`
 * and `table` are just kinds the assistant drew an icon for.
 */
export const Dashboard: Story = {
  args: {
    title: "/admin/overview",
    value: `# Overview
Last 30 days, all sites.
row
  [input: Date range]
  [input: Site]
  [button: Export CSV]
row
  [stat: Visitors 48,210 (+12%)]
  [stat: Edits published 1,304]
  [stat: Open proposals 17]
  [stat: Broken links 3]
row
  col 2
    ## Traffic
    [chart: Visitors per day, line]
  col
    ## Top pages
    [list: Ten most visited pages, with counts]
row
  col
    ## Edits by editor
    [chart: Bar per editor]
  col
    ## Content health
    [chart: Valid vs errors, donut]
## Recent edits
[table: Page, editor, change, time; newest first]

${icons("input", "button", "stat", "chart", "list", "table")}
`,
  },
};

/**
 * Boxes with media in them. The image and the video are written into the
 * text, so the assistant that builds the page uses exactly these files. Drop
 * another file on a box, or use the button in its corner, to change one.
 */
export const MediaInBoxes: Story = {
  args: {
    title: "/launch",
    value: `# The new Studio
[image: The Studio on a laptop](image: /storybook-media/intro-poster_a627f.webp)
Edit any page of your site where it is.
row
  col
    [video: Two minute walkthrough](video: /storybook-media/intro_51df2.mp4)
  col
    ## See it for yourself
    The walkthrough covers editing, review and publishing.
    [image: Drop a screenshot here]
    [button: Try the demo]

${icons("image", "video", "button")}
`,
  },
};

/**
 * Kinds nobody built in. The assistant names the box and draws its icon in
 * the same breath, so a countdown or a logo wall is as easy to sketch as an
 * image. A kind without an icon line gets no icon rather than a generic one.
 */
export const InventedBoxes: Story = {
  args: {
    title: "/campaign/spring",
    value: `# Spring launch
[countdown: Days until 1 April]
row
  [pricing: Team, 99 kr a month]
  [pricing: Business, 299 kr a month]
  [pricing: Enterprise, talk to us]
[logos: Customers who switched last year]
row
  col 2
    [testimonial: "Our editors publish on their own now."]
  col
    [newsletter: Get the launch email]
## Questions
[faq: Five questions from sales calls]
[carousel: No icon drawn for this one]

${icons("countdown", "pricing", "logos", "testimonial", "newsletter", "faq")}
`,
  },
};

/** Rows can go inside columns, as deep as the page needs. */
export const Nested: Story = {
  args: {
    title: "/contact",
    value: `# Contact us
row
  col 2
    ## Send us a message
    [form: Name, email and message]
    row
      [button: Send]
      [link: Read our privacy policy]
  col
    ## Visit us
    [map: Our office in Oslo]
    Storgata 1, 0155 Oslo

${icons("form", "button", "link", "map")}
`,
  },
};

/** On a phone: the toolbar wraps and the page takes the width. */
export const Phone: Story = {
  args: { value: ARTICLE, title: "/blog/cms-in-git" },
  decorators: [
    (Story) => (
      <div className="mx-auto h-full max-w-sm">
        <Story />
      </div>
    ),
  ],
};

// The assistant sketches a page step by step, as it would over a few tool
// calls. Each step is the whole sketch: the assistant rewrites it, it does
// not patch it.
const ASSISTANT_STEPS = [
  `# Our people
`,
  `# Our people
We are 40 designers and developers in Oslo.
`,
  `# Our people
We are 40 designers and developers in Oslo.
[image: The whole team on the roof]
`,
  `# Our people
We are 40 designers and developers in Oslo.
[image: The whole team on the roof]
row
  col
    ## Design
  col
    ## Development
`,
  `# Our people
We are 40 designers and developers in Oslo.
[image: The whole team on the roof]
row
  col
    ## Design
    [list: Designers, with portraits]
  col
    ## Development
    [list: Developers, with portraits]
## Join us
We are hiring.
[button: See open positions]
`,
  `# Our people
We are 40 designers and developers in Oslo.
[image: The whole team on the roof]
row
  col
    ## Design
    [list: Designers, with portraits]
  col
    ## Development
    [list: Developers, with portraits]
## Join us
We are hiring.
[button: See open positions]

${icons("image", "list", "button")}
`,
];

function AssistantEditing(props: SketchpadProps) {
  const [step, setStep] = useState(0);
  const [value, setValue] = useState(ASSISTANT_STEPS[0]);
  const done = step >= ASSISTANT_STEPS.length - 1;

  useEffect(() => {
    if (done) {
      return;
    }
    const timer = setTimeout(() => {
      setStep(step + 1);
      setValue(ASSISTANT_STEPS[step + 1]);
    }, 1200);
    return () => clearTimeout(timer);
  }, [step, done]);

  return (
    <Sketchpad
      {...props}
      value={value}
      onChange={setValue}
      readOnly={!done}
      status={
        done
          ? "The assistant finished. Edit anything you want changed."
          : `The assistant is sketching the page (step ${step + 1} of ${ASSISTANT_STEPS.length})…`
      }
    />
  );
}

/**
 * The assistant writes the sketch while the editor watches; the text is
 * read-only until it is done, then it is the editor's to change.
 */
export const AssistantSketching: Story = {
  args: { value: "", title: "/people" },
  render: (args) => <AssistantEditing {...args} />,
};

import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import { PageSketch, type PageSketchProps } from "../PageSketch";

/**
 * A page sketch: a scratch pad, kept outside the assistant's chat, where the
 * assistant and an editor agree on WHAT goes on a page before anyone worries
 * about how it looks. It is plain text with four primitives, so the assistant
 * can rewrite it in one go and an editor can fix one line of it:
 *
 * ```
 * # Heading / ## Sub / ### Small     text
 * Any other line                     text (a paragraph)
 * [image: Team photo]                placeholder: [kind] or [kind: label]
 * row                                its children side by side
 * col 2                              its children stacked; 2 shares of a row
 * ```
 *
 * The wireframe and the text are linked: click a block to select its line,
 * move the caret to highlight its block. The ASCII view is the same page as
 * monospace text — what the assistant would be handed back to "see" it.
 */
const meta: Meta<typeof PageSketch> = {
  title: "Components/PageSketch",
  component: PageSketch,
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
type Story = StoryObj<typeof PageSketch>;

/** Keeps the story's text in state, so typing in it works. */
function Editable(props: PageSketchProps) {
  const [value, setValue] = useState(props.value);
  useEffect(() => setValue(props.value), [props.value]);
  return <PageSketch {...props} value={value} onChange={setValue} />;
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
 * and `table` are just kinds the wireframe happens to draw an icon for.
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
`,
  },
};

/**
 * A sketch never fails to parse: a line it does not understand is reported,
 * with the way to fix it, and the rest of the page still renders. Click an
 * error to go to its line.
 */
export const WithErrors: Story = {
  args: {
    title: "/pricing",
    value: `# Pricing
Simple plans for every team.
  This line is indented under text
row 2
  col
    ## Free
    [button: Start
  col 0
    ## Team
    [button: Talk to sales]
`,
  },
};

/**
 * The same page as monospace text, as wide as the pane allows: what the
 * assistant gets back to see the page as the editor sees the wireframe.
 */
export const AsciiView: Story = {
  args: { value: LANDING, title: "/", defaultView: "ascii" },
};

/** The pane stacks the text over the page when there is no room for both. */
export const Narrow: Story = {
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
  `# Our people`,
  `# Our people
We are 40 designers and developers in Oslo.`,
  `# Our people
We are 40 designers and developers in Oslo.
[image: The whole team on the roof]`,
  `# Our people
We are 40 designers and developers in Oslo.
[image: The whole team on the roof]
row
  col
    ## Design
  col
    ## Development`,
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
[button: See open positions]`,
];

function AssistantEditing(props: PageSketchProps) {
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
    <PageSketch
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

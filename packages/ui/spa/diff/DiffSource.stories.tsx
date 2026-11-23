import type { Meta, StoryObj } from "@storybook/react";
import { placeholderImage } from "../components/stories/placeholderAssets";
import { diffSource } from "./diffSource";
import { DiffFields } from "./DiffValue";
import { PAGE, pageSchema, proposed, site } from "./pageFixture";
import type { DiffLayout } from "./types";

/**
 * The diff ENGINE, drawn: two Sources of one page go through `diffSource`,
 * and what comes out is rendered by the same component the hand-written
 * stories use.
 *
 * Nothing on this page was written as a diff. It is a schema, the page as the
 * site has it, and the page as a proposal has it. Which items moved, which
 * record entry was renamed and which paragraph changed are the engine's
 * answers, so this is the story to open when one of them looks wrong.
 */
function Engine({
  after,
  layout,
}: {
  /** The page to compare the site's with. */
  after: unknown;
  layout: DiffLayout;
}) {
  const fields = diffSource(
    { moduleFilePath: PAGE, schema: pageSchema, before: site, after },
    {
      // A story has no file server: a picture of the file's name instead.
      mediaUrl: (path) =>
        placeholderImage({
          width: 240,
          height: 168,
          text: path.slice(path.lastIndexOf("/") + 1, path.lastIndexOf("_")),
          bg: path.includes("office") ? "#99f6e4" : "#cbd5e1",
          fg: "#115e59",
        }),
    },
  );
  return (
    <div className="min-h-screen w-full bg-bg-primary p-6 text-fg-primary">
      <div className="mx-auto w-full max-w-3xl">
        {fields.length === 0 ? (
          <p className="py-16 text-center text-sm text-fg-tertiary">
            The two are the same: the engine has nothing to show.
          </p>
        ) : (
          <DiffFields fields={fields} layout={layout} />
        )}
      </div>
    </div>
  );
}

const meta: Meta<typeof Engine> = {
  title: "Review (proposed)/Diff engine",
  component: Engine,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof Engine>;

/** Every kind of change at once, marked in place. */
export const WholePageInline: Story = {
  args: { after: proposed, layout: "inline" },
};

/** The same, with the two sides in columns. */
export const WholePageSideBySide: Story = {
  args: { after: proposed, layout: "split" },
};

/** One section inserted in the middle: one line, and nothing after it changed. */
export const OneInsertion: Story = {
  args: {
    after: {
      ...site,
      sections: [
        site.sections[0],
        {
          type: "quote",
          title: "Testimonials",
          text: "It took an afternoon.",
          author: "Kari",
        },
        ...site.sections.slice(1),
      ],
    },
    layout: "inline",
  },
};

/** The last section moved first: every index shifted, and one item moved. */
export const OneMove: Story = {
  args: {
    after: {
      ...site,
      sections: [site.sections[3], ...site.sections.slice(0, 3)],
    },
    layout: "inline",
  },
};

/** The same page twice. */
export const NothingChanged: Story = {
  args: { after: site, layout: "inline" },
};

import type { Meta, StoryObj } from "@storybook/react";
import { DiffFields } from "./DiffValue";
import {
  addedTextField,
  bodyField,
  dateField,
  heroAltField,
  heroImageField,
  publishedField,
  removedTextField,
  rewrittenField,
  sectionsField,
  seoField,
  slugField,
  titleField,
} from "./fixtures";
import type { DiffLayout, FieldDiff } from "./types";

/**
 * One changed value of each kind, in both layouts at once.
 *
 * The two panels are the same fields through the same component: `inline`
 * marks the change in place and `split` puts the two sides in columns. They
 * are stacked here so the choice between them can be made per kind of value,
 * which is where they differ. A text reads well either way, and a list is the
 * same outline in both.
 */
function BothLayouts({
  fields,
  only,
}: {
  fields: FieldDiff[];
  /** Show one layout, for a story about that layout. */
  only?: DiffLayout;
}) {
  const layouts: DiffLayout[] =
    only === undefined ? ["inline", "split"] : [only];
  return (
    <div className="flex min-h-screen w-full flex-col gap-8 bg-bg-primary p-6 text-fg-primary">
      {layouts.map((layout) => (
        <section key={layout} className="mx-auto w-full max-w-3xl">
          <div className="mb-3 border-b border-border-secondary pb-1 text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
            {layout === "inline" ? "Inline" : "Side by side"}
          </div>
          <DiffFields fields={fields} layout={layout} />
        </section>
      ))}
    </div>
  );
}

const meta: Meta<typeof BothLayouts> = {
  title: "Review (proposed)/Diff of a value",
  component: BothLayouts,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof BothLayouts>;

/** A few words changed in a sentence, a slug, and a sentence rewritten whole. */
export const Text: Story = {
  args: { fields: [titleField, slugField, rewrittenField] },
};

/** A value that was not there before, and one that is gone. */
export const TextAddedAndRemoved: Story = {
  args: { fields: [addedTextField, removedTextField] },
};

/** Values read whole: a boolean and a date. */
export const Scalars: Story = {
  args: { fields: [publishedField, dateField] },
};

/** A picture replaced, and its alt text edited. */
export const Media: Story = {
  args: { fields: [heroImageField, heroAltField] },
};

/**
 * A list where items moved, were added, removed and edited.
 *
 * Each item is listed once, where it is now. Only "Pricing table" and "Footer
 * links" are marked as moved: the others changed index because of them, and
 * that is not a change.
 */
export const ListWithMoves: Story = {
  args: { fields: [sectionsField] },
};

/** A rich text: one paragraph edited, one block moved, two added, one removed. */
export const RichText: Story = {
  args: { fields: [bodyField] },
};

/** An object: only its changed fields, nested under its name. */
export const NestedObject: Story = {
  args: { fields: [seoField] },
};

/** Everything on one page, as a long page of a publish would look. */
export const Everything: Story = {
  args: {
    fields: [
      titleField,
      publishedField,
      heroImageField,
      heroAltField,
      sectionsField,
      bodyField,
      seoField,
    ],
  },
};

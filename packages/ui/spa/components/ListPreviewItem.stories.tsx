import type { Meta, StoryObj } from "@storybook/react";
import type { ImageSource } from "@valbuild/core";
import { ListPreviewItem } from "./ListPreviewItem";
import { placeholderImage } from "./stories/placeholderAssets";

/**
 * The row a value gets when its schema declares `.preview(...)`. Its whole job
 * is to look unlike the fallback: we know the row is a title, maybe a subtitle
 * and maybe an image, so it is laid out for exactly that and kept short.
 */
const meta: Meta<typeof ListPreviewItem> = {
  title: "Components/ListPreviewItem",
  component: ListPreviewItem,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="mx-auto w-[420px] rounded-lg border border-border-primary bg-bg-primary">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ListPreviewItem>;

// A media source is a plain object with a `path`; a data URL is not under
// `/public`, so `mediaUrl` serves it back as-is. See `architecture/media.md`.
const thumbnail: ImageSource = {
  path: placeholderImage({
    width: 80,
    height: 80,
    bg: "#e2e8f0",
    fg: "#475569",
    text: "A",
  }),
};

export const WithImage: Story = {
  args: {
    title: "Ada Lovelace",
    subtitle: "Notes on the analytical engine",
    image: thumbnail,
  },
};

export const WithoutImage: Story = {
  args: {
    title: "Grace Hopper",
    subtitle: "A ship in port is safe, but that is not what ships are for",
    image: null,
  },
};

export const TitleOnly: Story = {
  args: { title: "Katherine Johnson", subtitle: null, image: null },
};

/** Both lines are one line each: a long value is truncated, never wrapped. */
export const Truncates: Story = {
  args: {
    title:
      "A title long enough that it has nowhere left to go on a single line",
    subtitle:
      "And a subtitle that is likewise far too long to fit inside the row it was given",
    image: thumbnail,
  },
};

/** `size="compact"` — smaller thumbnail and type, for search hits. */
export const Compact: Story = {
  args: {
    title: "Ada Lovelace",
    subtitle: "Notes on the analytical engine",
    image: thumbnail,
    size: "compact",
  },
};

/**
 * Several rows together: the density a page-builder tree is aiming for, and
 * the reason a missing image still reserves its column — the third row would
 * otherwise start its title 52px left of the two above it.
 */
export const List: Story = {
  render: () => (
    <div className="flex flex-col">
      <ListPreviewItem
        title="Ada Lovelace"
        subtitle="Notes on the analytical engine"
        image={thumbnail}
      />
      <ListPreviewItem
        title="Grace Hopper"
        subtitle="A ship in port is safe"
        image={thumbnail}
      />
      <ListPreviewItem
        title="Katherine Johnson"
        subtitle="Taught herself analytic geometry"
        image={null}
      />
    </div>
  ),
};

/** A list whose preview declares no image at all: no dead column anywhere. */
export const ListWithoutImages: Story = {
  render: () => (
    <div className="flex flex-col">
      <ListPreviewItem title="Ada Lovelace" subtitle="Analytical engine" />
      <ListPreviewItem title="Grace Hopper" subtitle="COBOL" />
      <ListPreviewItem title="Katherine Johnson" subtitle="Orbital mechanics" />
    </div>
  ),
};

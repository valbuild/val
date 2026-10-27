import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ImagePicker } from "./ImagePickerComponent";
import type { EditorImage } from "../types";
import { placeholderImage } from "../../stories/placeholderAssets";

const sampleImages: EditorImage[] = [
  {
    url: placeholderImage({
      width: 600,
      height: 400,
      bg: "#e2e8f0",
      fg: "#475569",
      text: "Mountains",
    }),
  },
  {
    url: placeholderImage({
      width: 600,
      height: 400,
      bg: "#fce7f3",
      fg: "#9d174d",
      text: "Sunset",
    }),
  },
  {
    url: placeholderImage({
      width: 600,
      height: 400,
      bg: "#d1fae5",
      fg: "#065f46",
      text: "Forest",
    }),
  },
  {
    url: placeholderImage({
      width: 600,
      height: 400,
      bg: "#dbeafe",
      fg: "#1e40af",
      text: "Ocean",
    }),
  },
  {
    url: placeholderImage({
      width: 600,
      height: 400,
      bg: "#fef3c7",
      fg: "#92400e",
      text: "Desert",
    }),
  },
];

const meta: Meta<typeof ImagePicker> = {
  title: "RichTextEditor/ImagePicker",
  component: ImagePicker,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-sm p-4">
        <div className="rounded-md border border-border-primary bg-bg-primary p-3 shadow-lg">
          <Story />
        </div>
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ImagePicker>;

export const Default: Story = {
  args: {
    images: sampleImages,
    currentSrc: "",
    onSelect: (url) => console.log("Selected:", url),
  },
};

export const WithSelection: Story = {
  args: {
    images: sampleImages,
    currentSrc: placeholderImage({
      width: 600,
      height: 400,
      bg: "#d1fae5",
      fg: "#065f46",
      text: "Forest",
    }),
    onSelect: (url) => console.log("Selected:", url),
  },
};

export const SingleImage: Story = {
  args: {
    images: [
      {
        url: placeholderImage({
          width: 600,
          height: 400,
          bg: "#e2e8f0",
          fg: "#475569",
          text: "Only One",
        }),
      },
    ],
    currentSrc: "",
    onSelect: (url) => console.log("Selected:", url),
  },
};

export const ManyImages: Story = {
  args: {
    images: Array.from({ length: 12 }, (_, i) => ({
      url: placeholderImage({
        width: 600,
        height: 400,
        text: `Image ${i + 1}`,
      }),
    })),
    currentSrc: "",
    onSelect: (url) => console.log("Selected:", url),
  },
};

function InteractiveStory() {
  const [selected, setSelected] = useState("");

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-border-primary bg-bg-primary p-3 shadow-lg">
        <ImagePicker
          images={sampleImages}
          currentSrc={selected}
          onSelect={setSelected}
        />
      </div>
      <div className="rounded border border-border-secondary bg-bg-secondary p-3">
        <div className="text-sm font-bold text-fg-secondary">Selected URL</div>
        <pre className="mt-1 text-xs text-fg-secondary-alt">
          {selected || "(none)"}
        </pre>
      </div>
    </div>
  );
}

export const Interactive: Story = {
  render: () => <InteractiveStory />,
};

import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { FilenameInput } from "../FilenameInput";

const meta: Meta<typeof FilenameInput> = {
  title: "FileGallery/FilenameInput",
  component: FilenameInput,
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof FilenameInput>;

export const Default: Story = {
  args: {
    filename: "landscape.jpg",
    onSave: (newFilename) => console.log("Save:", newFilename),
  },
};

export const WithLongFilename: Story = {
  args: {
    filename: "this-is-a-very-long-filename-that-should-truncate.jpg",
    onSave: (newFilename) => console.log("Save:", newFilename),
  },
};

export const NoExtension: Story = {
  args: {
    filename: "README",
    onSave: (newFilename) => console.log("Save:", newFilename),
  },
};

export const MultipleExtensions: Story = {
  args: {
    filename: "archive.tar.gz",
    onSave: (newFilename) => console.log("Save:", newFilename),
  },
};

export const HiddenFile: Story = {
  args: {
    filename: ".gitignore",
    onSave: (newFilename) => console.log("Save:", newFilename),
  },
};

export const Disabled: Story = {
  args: {
    filename: "readonly-file.pdf",
    onSave: (newFilename) => console.log("Save:", newFilename),
    disabled: true,
  },
};

export const Interactive: Story = {
  render: function Render() {
    const [filename, setFilename] = useState("my-photo.jpg");

    return (
      <div className="space-y-4">
        <FilenameInput filename={filename} onSave={setFilename} />
        <p className="text-sm text-fg-secondary">
          Current filename: <code>{filename}</code>
        </p>
      </div>
    );
  },
};

export const DifferentExtensions: Story = {
  render: () => (
    <div className="space-y-2">
      <FilenameInput filename="document.pdf" onSave={(f) => console.log(f)} />
      <FilenameInput filename="video.mp4" onSave={(f) => console.log(f)} />
      <FilenameInput filename="image.webp" onSave={(f) => console.log(f)} />
      <FilenameInput filename="data.json" onSave={(f) => console.log(f)} />
    </div>
  ),
};

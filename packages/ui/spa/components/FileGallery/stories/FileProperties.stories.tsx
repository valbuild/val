import type { Meta, StoryObj } from "@storybook/react";
import { FileProperties } from "../FileProperties";
import type { GalleryFile } from "../types";

const meta: Meta<typeof FileProperties> = {
  title: "FileGallery/FileProperties",
  component: FileProperties,
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
type Story = StoryObj<typeof FileProperties>;

const sampleImageFile: GalleryFile = {
  url: "/sample-landscape.jpg",
  filename: "sample-landscape.jpg",
  folder: "/public/val/images",
  metadata: {
    width: 1920,
    height: 1080,
    mimeType: "image/jpeg",
    alt: "A beautiful mountain landscape",
  },
  createdAt: new Date("2024-01-15T10:30:00"),
};

const sampleVideoFile: GalleryFile = {
  url: "/sample-video.mp4",
  filename: "promotional-video.mp4",
  folder: "/public/val/videos",
  metadata: {
    width: 1920,
    height: 1080,
    mimeType: "video/mp4",
  },
  createdAt: new Date("2024-02-20T14:45:00"),
};

const sampleDocumentFile: GalleryFile = {
  url: "/document.pdf",
  filename: "annual-report-2024.pdf",
  folder: "/public/val/documents",
  metadata: {
    width: 0,
    height: 0,
    mimeType: "application/pdf",
  },
};

const fileWithoutAlt: GalleryFile = {
  url: "/no-alt-image.png",
  filename: "no-alt-image.png",
  folder: "/public/val/images",
  metadata: {
    width: 800,
    height: 600,
    mimeType: "image/png",
  },
  createdAt: new Date("2024-03-10T09:00:00"),
};

export const ImageFile: Story = {
  args: {
    file: sampleImageFile,
    fileIndex: 0,
    imageMode: true,
    onFileRename: (index, newFilename) =>
      console.log(`Rename file ${index} to: ${newFilename}`),
    onAltTextChange: (index, newAltText) =>
      console.log(`Alt text for ${index}: ${newAltText}`),
  },
};

export const ImageFileReadOnly: Story = {
  args: {
    file: sampleImageFile,
    fileIndex: 0,
    imageMode: true,
  },
};

export const ImageWithoutAltText: Story = {
  args: {
    file: fileWithoutAlt,
    fileIndex: 0,
    imageMode: true,
    onFileRename: (index, newFilename) =>
      console.log(`Rename file ${index} to: ${newFilename}`),
    onAltTextChange: (index, newAltText) =>
      console.log(`Alt text for ${index}: ${newAltText}`),
  },
};

export const VideoFile: Story = {
  args: {
    file: sampleVideoFile,
    fileIndex: 0,
    onFileRename: (index, newFilename) =>
      console.log(`Rename file ${index} to: ${newFilename}`),
  },
};

export const DocumentFile: Story = {
  args: {
    file: sampleDocumentFile,
    fileIndex: 0,
    onFileRename: (index, newFilename) =>
      console.log(`Rename file ${index} to: ${newFilename}`),
  },
};

export const WithoutCreatedDate: Story = {
  args: {
    file: sampleDocumentFile,
    fileIndex: 0,
  },
};

export const ImageModeOff: Story = {
  args: {
    file: sampleImageFile,
    fileIndex: 0,
    imageMode: false,
    onFileRename: (index, newFilename) =>
      console.log(`Rename file ${index} to: ${newFilename}`),
    onAltTextChange: (index, newAltText) =>
      console.log(`Alt text for ${index}: ${newAltText}`),
  },
};

export const LongFilename: Story = {
  args: {
    file: {
      ...sampleImageFile,
      filename:
        "this-is-a-very-long-filename-that-should-be-truncated-properly-in-the-ui.jpg",
    },
    fileIndex: 0,
    imageMode: true,
    onFileRename: (index, newFilename) =>
      console.log(`Rename file ${index} to: ${newFilename}`),
  },
};

export const LongFolderPath: Story = {
  args: {
    file: {
      ...sampleImageFile,
      folder: "/public/val/images/deeply/nested/folder/structure/here",
    },
    fileIndex: 0,
    imageMode: true,
  },
};

import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { FileGallery } from "../FileGallery";
import type { GalleryFile } from "../types";

const meta: Meta<typeof FileGallery> = {
  title: "Components/FileGallery",
  component: FileGallery,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof FileGallery>;

const imageFiles: GalleryFile[] = [
  {
    url: "/sample-image-1.jpg",
    filename: "landscape.jpg",
    folder: "/images/photos",
    metadata: {
      width: 800,
      height: 600,
      mimeType: "image/jpeg",
    },
  },
  {
    url: "/sample-image-2.jpg",
    filename: "portrait.jpg",
    folder: "/images/photos",
    metadata: {
      width: 600,
      height: 800,
      mimeType: "image/jpeg",
    },
  },
  {
    url: "/sample-image-3.jpg",
    filename: "wide-shot.jpg",
    folder: "/images/banners",
    metadata: {
      width: 1200,
      height: 800,
      mimeType: "image/jpeg",
    },
  },
];

const mixedFiles: GalleryFile[] = [
  ...imageFiles,
  {
    url: "/sample-video.mp4",
    filename: "demo-video.mp4",
    folder: "/videos",
    metadata: {
      width: 320,
      height: 176,
      mimeType: "video/mp4",
    },
  },
  {
    url: "#",
    filename: "background-music.mp3",
    folder: "/audio",
    metadata: {
      width: 0,
      height: 0,
      mimeType: "audio/mpeg",
    },
  },
  {
    url: "#",
    filename: "config.json",
    folder: "/data",
    metadata: {
      width: 0,
      height: 0,
      mimeType: "application/json",
    },
  },
  {
    url: "#",
    filename: "readme.txt",
    folder: "/docs",
    metadata: {
      width: 0,
      height: 0,
      mimeType: "text/plain",
    },
  },
  {
    url: "#",
    filename: "archive.zip",
    folder: "/downloads",
    metadata: {
      width: 0,
      height: 0,
      mimeType: "application/zip",
    },
  },
];

export const Empty: Story = {
  render: () => <FileGallery files={[]} />,
};

export const ImagesOnly: Story = {
  render: () => <FileGallery files={imageFiles} />,
};

export const MixedMedia: Story = {
  render: () => <FileGallery files={mixedFiles} />,
};

export const WithRenameHandler: Story = {
  render: function Render() {
    const [files, setFiles] = useState<GalleryFile[]>(imageFiles);

    const handleRename = (index: number, newFilename: string) => {
      setFiles((prev) =>
        prev.map((file, i) =>
          i === index ? { ...file, filename: newFilename } : file,
        ),
      );
    };

    return <FileGallery files={files} onFileRename={handleRename} />;
  },
};

export const SingleFile: Story = {
  render: () => <FileGallery files={[imageFiles[0]]} />,
};

export const ManyFiles: Story = {
  render: () => (
    <FileGallery
      files={[
        ...imageFiles,
        ...imageFiles.map((f, i) => ({
          ...f,
          filename: `copy-${i + 1}-${f.filename}`,
        })),
        ...imageFiles.map((f, i) => ({
          ...f,
          filename: `backup-${i + 1}-${f.filename}`,
        })),
      ]}
    />
  ),
};

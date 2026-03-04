import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { FileGallery } from "../FileGallery";
import type { GalleryFile } from "../types";
import { ValPortalProvider } from "../../ValPortalProvider";
import { ValThemeProvider } from "../../ValThemeProvider";

const meta: Meta<typeof FileGallery> = {
  title: "Components/FileGallery",
  component: FileGallery,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <ValThemeProvider theme="dark" setTheme={() => {}} config={undefined}>
        <ValPortalProvider>
          <Story />
        </ValPortalProvider>
      </ValThemeProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof FileGallery>;

const imageFiles: GalleryFile[] = [
  {
    ref: "/images/photos/landscape.jpg",
    url: "/sample-image-1.jpg",
    filename: "landscape.jpg",
    folder: "/images/photos",
    metadata: {
      width: 800,
      height: 600,
      mimeType: "image/jpeg",
      alt: "A beautiful landscape",
    },
    createdAt: new Date("2025-12-15T10:30:00"),
  },
  {
    ref: "/images/photos/portrait.jpg",
    url: "/sample-image-2.jpg",
    filename: "portrait.jpg",
    folder: "/images/photos",
    metadata: {
      width: 600,
      height: 800,
      mimeType: "image/jpeg",
    },
    createdAt: new Date("2025-12-20T14:45:00"),
  },
  {
    ref: "/images/banners/wide-shot.jpg",
    url: "/sample-image-3.jpg",
    filename: "wide-shot.jpg",
    folder: "/images/banners",
    metadata: {
      width: 1200,
      height: 800,
      mimeType: "image/jpeg",
      alt: "Wide panoramic shot",
    },
  },
];

const mixedFiles: GalleryFile[] = [
  ...imageFiles,
  {
    ref: "/videos/demo-video.mp4",
    url: "/sample-video.mp4",
    filename: "demo-video.mp4",
    folder: "/videos",
    metadata: {
      width: 320,
      height: 176,
      mimeType: "video/mp4",
    },
    createdAt: new Date("2025-11-10T09:00:00"),
  },
  {
    ref: "/audio/background-music.mp3",
    url: "#",
    filename: "background-music.mp3",
    folder: "/audio",
    metadata: {
      width: 0,
      height: 0,
      mimeType: "audio/mpeg",
    },
    createdAt: new Date("2026-01-05T16:20:00"),
  },
  {
    ref: "/data/config.json",
    url: "#",
    filename: "config.json",
    folder: "/data",
    metadata: {
      width: 0,
      height: 0,
      mimeType: "application/json",
    },
    createdAt: new Date("2025-10-01T12:00:00"),
  },
  {
    ref: "/docs/readme.txt",
    url: "#",
    filename: "readme.txt",
    folder: "/docs",
    metadata: {
      width: 0,
      height: 0,
      mimeType: "text/plain",
    },
    createdAt: new Date("2026-02-01T08:30:00"),
  },
  {
    ref: "/downloads/archive.zip",
    url: "#",
    filename: "archive.zip",
    folder: "/downloads",
    metadata: {
      width: 0,
      height: 0,
      mimeType: "application/zip",
    },
    createdAt: new Date("2025-12-25T00:00:00"),
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

export const GridView: Story = {
  render: () => (
    <FileGallery
      files={[
        ...imageFiles,
        ...imageFiles.map((f, i) => ({
          ...f,
          filename: `copy-${i + 1}-${f.filename}`,
        })),
      ]}
      defaultViewMode="grid"
    />
  ),
};

export const WithoutSearch: Story = {
  render: () => <FileGallery files={imageFiles} showSearch={false} />,
};

export const ImageModeWithAltText: Story = {
  render: function Render() {
    const [files, setFiles] = useState<GalleryFile[]>(imageFiles);

    const handleRename = (index: number, newFilename: string) => {
      setFiles((prev) =>
        prev.map((file, i) =>
          i === index ? { ...file, filename: newFilename } : file,
        ),
      );
    };

    const handleAltTextChange = (index: number, newAltText: string) => {
      setFiles((prev) =>
        prev.map((file, i) =>
          i === index
            ? { ...file, metadata: { ...file.metadata, alt: newAltText } }
            : file,
        ),
      );
    };

    return (
      <FileGallery
        files={files}
        onFileRename={handleRename}
        onAltTextChange={handleAltTextChange}
        imageMode
      />
    );
  },
};

export const ListView: Story = {
  render: () => (
    <FileGallery
      files={[...imageFiles, ...mixedFiles.slice(3)]}
      defaultViewMode="list"
    />
  ),
};

export const WithValidationErrors: Story = {
  render: () => (
    <FileGallery
      files={[
        imageFiles[0],
        {
          ...imageFiles[1],
          validationErrors: ["Missing alt text", "Image too small"],
        },
        imageFiles[2],
        {
          ...mixedFiles[3],
          validationErrors: ["File format not supported"],
        },
        mixedFiles[4],
      ]}
      imageMode
    />
  ),
};

export const Loading: Story = {
  render: () => <FileGallery files={[]} loading />,
};

export const Disabled: Story = {
  render: function Render() {
    const handleRename = (index: number, newFilename: string) => {
      console.log(`Rename file ${index} to: ${newFilename}`);
    };

    const handleAltTextChange = (index: number, newAltText: string) => {
      console.log(`Alt text for ${index}: ${newAltText}`);
    };

    return (
      <FileGallery
        files={imageFiles}
        onFileRename={handleRename}
        onAltTextChange={handleAltTextChange}
        imageMode
        disabled
      />
    );
  },
};

// Generate many files for virtualization testing
function generateManyFiles(count: number): GalleryFile[] {
  const baseFiles = [
    {
      url: "/sample-image-1.jpg",
      filename: "landscape",
      folder: "/images/photos",
      metadata: { width: 800, height: 600, mimeType: "image/jpeg" },
    },
    {
      url: "/sample-image-2.jpg",
      filename: "portrait",
      folder: "/images/photos",
      metadata: { width: 600, height: 800, mimeType: "image/jpeg" },
    },
    {
      url: "/sample-image-3.jpg",
      filename: "wide-shot",
      folder: "/images/banners",
      metadata: { width: 1200, height: 800, mimeType: "image/jpeg" },
    },
    {
      url: "/sample-video.mp4",
      filename: "video",
      folder: "/media/videos",
      metadata: { width: 1920, height: 1080, mimeType: "video/mp4" },
    },
    {
      url: "/document.pdf",
      filename: "document",
      folder: "/docs",
      metadata: { width: 0, height: 0, mimeType: "application/pdf" },
    },
  ];

  return Array.from({ length: count }, (_, i) => {
    const base = baseFiles[i % baseFiles.length];
    const filename = `${base.filename}-${i + 1}.${base.metadata.mimeType.split("/")[1]}`;
    return {
      ...base,
      ref: `${base.folder}/${filename}`,
      filename,
      createdAt: new Date(Date.now() - i * 1000 * 60 * 60 * 24),
    };
  });
}

export const VirtualizedList: Story = {
  render: () => (
    <FileGallery files={generateManyFiles(1000)} defaultViewMode="list" />
  ),
};

export const VirtualizedMasonry: Story = {
  render: () => (
    <FileGallery files={generateManyFiles(500)} defaultViewMode="masonry" />
  ),
};

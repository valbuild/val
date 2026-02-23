import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { MediaPicker } from "../MediaPicker";
import type { GalleryEntry } from "../MediaPicker";

const meta: Meta<typeof MediaPicker> = {
  title: "Components/MediaPicker",
  component: MediaPicker,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof MediaPicker>;

const singleModuleImages: Record<
  string,
  Record<string, Record<string, unknown>>
> = {
  "/content/media.val.ts": {
    "/public/val/images/logo.png": {
      width: 800,
      height: 600,
      mimeType: "image/png",
      alt: "Company logo",
    },
    "/public/val/images/hero.jpg": {
      width: 1920,
      height: 1080,
      mimeType: "image/jpeg",
      alt: "Hero banner image",
    },
    "/public/val/images/team.webp": {
      width: 640,
      height: 480,
      mimeType: "image/webp",
      alt: "Team photo",
    },
    "/public/val/images/product-shot.png": {
      width: 1200,
      height: 900,
      mimeType: "image/png",
      alt: "Product screenshot",
    },
  },
};

const multiModuleImages: Record<
  string,
  Record<string, Record<string, unknown>>
> = {
  "/content/media.val.ts": {
    "/public/val/images/logo.png": {
      width: 800,
      height: 600,
      mimeType: "image/png",
      alt: "Company logo",
    },
    "/public/val/images/hero.jpg": {
      width: 1920,
      height: 1080,
      mimeType: "image/jpeg",
      alt: "Hero banner",
    },
  },
  "/content/blog-images.val.ts": {
    "/public/val/blog/post-1.jpg": {
      width: 800,
      height: 400,
      mimeType: "image/jpeg",
      alt: "Blog post 1 cover",
    },
    "/public/val/blog/post-2.png": {
      width: 1200,
      height: 630,
      mimeType: "image/png",
      alt: "Blog post 2 cover",
    },
    "/public/val/blog/thumbnail.webp": {
      width: 300,
      height: 300,
      mimeType: "image/webp",
    },
  },
};

const singleModuleFiles: Record<
  string,
  Record<string, Record<string, unknown>>
> = {
  "/content/documents.val.ts": {
    "/public/val/docs/readme.pdf": {
      mimeType: "application/pdf",
    },
    "/public/val/docs/guide.pdf": {
      mimeType: "application/pdf",
    },
    "/public/val/docs/changelog.txt": {
      mimeType: "text/plain",
    },
    "/public/val/docs/data.json": {
      mimeType: "application/json",
    },
  },
};

export const ImageGallery: Story = {
  render: function Render() {
    const [selected, setSelected] = useState<string | null>(null);
    return (
      <div className="w-80">
        <MediaPicker
          moduleEntries={singleModuleImages}
          selectedRef={selected}
          onSelect={(entry: GalleryEntry) => setSelected(entry.filePath)}
          isImage
        />
        {selected && (
          <p className="mt-2 text-xs text-fg-secondary">
            Selected: {selected}
          </p>
        )}
      </div>
    );
  },
};

export const ImageGalleryPreselected: Story = {
  render: () => (
    <div className="w-80">
      <MediaPicker
        moduleEntries={singleModuleImages}
        selectedRef="/public/val/images/hero.jpg"
        onSelect={() => {}}
        isImage
      />
    </div>
  ),
};

export const MultipleModules: Story = {
  render: function Render() {
    const [selected, setSelected] = useState<string | null>(null);
    const [lastModule, setLastModule] = useState<string | null>(null);
    return (
      <div className="w-80">
        <MediaPicker
          moduleEntries={multiModuleImages}
          selectedRef={selected}
          onSelect={(entry: GalleryEntry) => {
            setSelected(entry.filePath);
            setLastModule(entry.modulePath);
          }}
          isImage
        />
        {selected && (
          <div className="mt-2 text-xs text-fg-secondary">
            <p>Selected: {selected}</p>
            <p>From: {lastModule}</p>
          </div>
        )}
      </div>
    );
  },
};

export const FileGallery: Story = {
  render: function Render() {
    const [selected, setSelected] = useState<string | null>(null);
    return (
      <div className="w-80">
        <MediaPicker
          moduleEntries={singleModuleFiles}
          selectedRef={selected}
          onSelect={(entry: GalleryEntry) => setSelected(entry.filePath)}
          isImage={false}
        />
        {selected && (
          <p className="mt-2 text-xs text-fg-secondary">
            Selected: {selected}
          </p>
        )}
      </div>
    );
  },
};

export const Disabled: Story = {
  render: () => (
    <div className="w-80">
      <MediaPicker
        moduleEntries={singleModuleImages}
        onSelect={() => {}}
        isImage
        disabled
      />
    </div>
  ),
};

export const EmptyGallery: Story = {
  render: () => (
    <div className="w-80">
      <MediaPicker
        moduleEntries={{ "/content/media.val.ts": {} }}
        onSelect={() => {}}
        isImage
      />
    </div>
  ),
};

export const NoModules: Story = {
  render: () => (
    <div className="w-80">
      <MediaPicker moduleEntries={{}} onSelect={() => {}} isImage />
    </div>
  ),
};

/**
 * Generate a large set of gallery entries for virtualization testing.
 * Creates `count` images spread across `moduleCount` modules.
 */
function generateManyImages(
  count: number,
  moduleCount = 1,
): Record<string, Record<string, Record<string, unknown>>> {
  const folders = [
    "photos",
    "banners",
    "icons",
    "backgrounds",
    "avatars",
    "screenshots",
    "illustrations",
    "thumbnails",
  ];
  const extensions = ["jpg", "png", "webp"];
  const widths = [800, 1200, 1920, 640, 400, 300];
  const heights = [600, 800, 1080, 480, 400, 300];

  const modules: Record<string, Record<string, Record<string, unknown>>> = {};

  for (let m = 0; m < moduleCount; m++) {
    const modName =
      moduleCount === 1
        ? "/content/media.val.ts"
        : `/content/${folders[m % folders.length]}-gallery.val.ts`;
    modules[modName] = {};
  }

  const moduleKeys = Object.keys(modules);
  for (let i = 0; i < count; i++) {
    const mod = moduleKeys[i % moduleKeys.length];
    const folder = folders[i % folders.length];
    const ext = extensions[i % extensions.length];
    const w = widths[i % widths.length];
    const h = heights[i % heights.length];

    modules[mod][`/public/val/images/${folder}/image-${i + 1}.${ext}`] = {
      width: w,
      height: h,
      mimeType: `image/${ext === "jpg" ? "jpeg" : ext}`,
      alt: `${folder} image ${i + 1}`,
    };
  }

  return modules;
}

export const VirtualizedLargeGallery: Story = {
  render: function Render() {
    const [selected, setSelected] = useState<string | null>(null);
    const manyImages = generateManyImages(500);
    return (
      <div className="w-96">
        <p className="mb-2 text-xs text-fg-secondary">
          500 images, virtualized list
        </p>
        <MediaPicker
          moduleEntries={manyImages}
          selectedRef={selected}
          onSelect={(entry: GalleryEntry) => setSelected(entry.filePath)}
          isImage
        />
        {selected && (
          <p className="mt-2 text-xs text-fg-secondary truncate">
            Selected: {selected}
          </p>
        )}
      </div>
    );
  },
};

export const VirtualizedMultiModule: Story = {
  render: function Render() {
    const [selected, setSelected] = useState<string | null>(null);
    const manyImages = generateManyImages(300, 4);
    return (
      <div className="w-96">
        <p className="mb-2 text-xs text-fg-secondary">
          300 images across 4 modules, virtualized with headings
        </p>
        <MediaPicker
          moduleEntries={manyImages}
          selectedRef={selected}
          onSelect={(entry: GalleryEntry) => setSelected(entry.filePath)}
          isImage
        />
        {selected && (
          <p className="mt-2 text-xs text-fg-secondary truncate">
            Selected: {selected}
          </p>
        )}
      </div>
    );
  },
};

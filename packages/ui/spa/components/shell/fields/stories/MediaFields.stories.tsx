import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { FileField } from "../FileField";
import { ImageField } from "../ImageField";
import { MediaCollection, MediaCollectionMode } from "../MediaCollection";
import {
  mockFile,
  mockFileFolders,
  mockFiles,
  mockImage,
  mockImageFolders,
  mockImages,
} from "../mockMedia";
import { FileEntry, ImageEntry, MediaEntry } from "../types";

/**
 * The three shapes a media field comes in, for images and for files.
 *
 * Val has two ways to hold a file and they behave differently, which is the
 * thing these designs have to get right:
 *
 * - `s.image()` — the field owns the file. Alt text and the focal point are
 *   stored on the field, and nothing else refers to them.
 * - `s.image(collection)` — the field points into an `s.images()` module. The
 *   metadata lives in the collection, and the field keeps its own copy of the
 *   alt text, so it can say something different for this one use.
 * - `s.images()` — the collection itself: a record keyed by file path. This
 *   is the module an editor opens to manage the library, and the same view a
 *   field opens to pick from it.
 *
 * Everything here is presentational — no providers, no patches. These are
 * design stories.
 */
const meta: Meta = {
  title: "Shell/Media fields",
  parameters: { layout: "fullscreen" },
};
export default meta;

/** Dark is the shell's default, so the stories are shown in it. */
function Frame({
  title,
  description,
  children,
  width = 560,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  width?: number;
}) {
  return (
    <div
      data-mode="dark"
      className="min-h-screen bg-bg-canvas p-6 font-sans text-fg-primary"
    >
      <div style={{ maxWidth: width }} className="mx-auto">
        <h1 className="text-[0.9375rem] font-semibold tracking-tight">
          {title}
        </h1>
        <p className="mb-5 mt-1 text-xs leading-relaxed text-fg-secondary-alt">
          {description}
        </p>
        {children}
      </div>
    </div>
  );
}

type Story = StoryObj;

/* ---------------------------------------------------------------- images -- */

function OwnImageHarness({ start }: { start: ImageEntry | null }) {
  const [value, setValue] = useState<ImageEntry | null>(start);
  return (
    <ImageField
      value={value}
      source={{ kind: "own" }}
      onChange={setValue}
      onClear={() => setValue(null)}
      onBrowse={() => undefined}
      onUpload={() => setValue(mockImage)}
      sourcePath='/content/pages.val.ts?p="/"."hero"."image"'
      isDevMode
    />
  );
}

/**
 * `s.image()`. The field owns the file, so it owns the alt text and the focal
 * point too — drag the point, or use the number fields, and watch the three
 * crop previews follow.
 */
export const ImageFieldOwn: Story = {
  render: () => (
    <Frame
      title="s.image()"
      description="The field owns the file. Alt text and focal point are stored on the field."
    >
      <OwnImageHarness start={mockImage} />
    </Frame>
  ),
};

/** The same field with nothing in it yet. */
export const ImageFieldEmpty: Story = {
  render: () => (
    <Frame
      title="s.image() — empty"
      description="Nothing chosen yet. Upload puts the mock image in."
    >
      <OwnImageHarness start={null} />
    </Frame>
  ),
};

/** An image with no alt text, which is valid and still worth flagging. */
export const ImageFieldMissingAlt: Story = {
  render: () => (
    <Frame
      title="s.image() — no alt text"
      description="Valid unless the schema says otherwise, and the one thing everyone forgets."
    >
      <OwnImageHarness
        start={{ ...mockImage, alt: null, hotspot: undefined }}
      />
    </Frame>
  ),
};

function CollectionImageHarness({ start }: { start: ImageEntry | null }) {
  const libraryAlt = mockImage.alt;
  const [value, setValue] = useState<ImageEntry | null>(start);
  return (
    <ImageField
      value={value}
      source={{
        kind: "collection",
        name: "Media",
        moduleFilePath: "/content/media.val.ts",
      }}
      collectionAlt={libraryAlt}
      onChange={setValue}
      onClear={() => setValue(null)}
      onBrowse={() => undefined}
      onUpload={() => undefined}
      sourcePath='/content/authors.val.ts?p="teddy"."image"'
      isDevMode
    />
  );
}

/**
 * `s.image(media)`. The file belongs to the collection, so there is no upload
 * here — only a choice. Alt text comes from the library and can be overridden
 * for this one use: "person looking at mountains" describes the picture,
 * "our founder, in Norway" describes why it is on this page.
 */
export const ImageFieldFromCollection: Story = {
  render: () => (
    <Frame
      title="s.image(media)"
      description="Points into an s.images() collection. Alt text comes from the library, and can be overridden per field."
    >
      <CollectionImageHarness start={mockImage} />
    </Frame>
  ),
};

/** The same, with an override already in place. */
export const ImageFieldOverriddenAlt: Story = {
  render: () => (
    <Frame
      title="s.image(media) — overridden alt text"
      description="The field says something different from the library, and shows what the library says."
    >
      <CollectionImageHarness
        start={{ ...mockImage, alt: "Our founder, on a trip to Norway" }}
      />
    </Frame>
  ),
};

/** Collection-backed and empty: nothing to upload into, only to choose from. */
export const ImageFieldFromCollectionEmpty: Story = {
  render: () => (
    <Frame
      title="s.image(media) — empty"
      description="No upload button: files reach this field by being in the collection first."
    >
      <CollectionImageHarness start={null} />
    </Frame>
  ),
};

/* ----------------------------------------------------------------- files -- */

function FileHarness({
  start,
  fromCollection,
}: {
  start: FileEntry | null;
  fromCollection: boolean;
}) {
  const [value, setValue] = useState<FileEntry | null>(start);
  return (
    <FileField
      value={value}
      source={
        fromCollection
          ? {
              kind: "collection",
              name: "Documents",
              moduleFilePath: "/content/documents.val.ts",
            }
          : { kind: "own" }
      }
      onClear={() => setValue(null)}
      onBrowse={() => undefined}
      onUpload={() => setValue(mockFile)}
      onOpen={() => undefined}
      onDownload={() => undefined}
      sourcePath='/content/pages.val.ts?p="/press"."kit"'
      isDevMode
    />
  );
}

/**
 * `s.file()`. Shorter than the image field on purpose: Val stores a reference
 * and a mime type, so there is nothing to describe and nothing to aim at.
 */
export const FileFieldOwn: Story = {
  render: () => (
    <Frame
      title="s.file()"
      description="A reference and a mime type. Everything else about a file is a fact, not a decision."
    >
      <FileHarness start={mockFile} fromCollection={false} />
    </Frame>
  ),
};

export const FileFieldEmpty: Story = {
  render: () => (
    <Frame title="s.file() — empty" description="Nothing attached yet.">
      <FileHarness start={null} fromCollection={false} />
    </Frame>
  ),
};

/** `s.file(documents)`. Same shape, but the file belongs to a collection. */
export const FileFieldFromCollection: Story = {
  render: () => (
    <Frame
      title="s.file(documents)"
      description="Points into an s.files() collection, which is named in the details."
    >
      <FileHarness start={mockFile} fromCollection />
    </Frame>
  ),
};

/* ------------------------------------------------------------ collections -- */

function CollectionHarness({
  mode,
  entries: initial,
  name,
  moduleFilePath,
  directory,
  accept,
  folders,
}: {
  mode: MediaCollectionMode;
  entries: MediaEntry[];
  name: string;
  moduleFilePath: string;
  directory: string;
  accept: string;
  folders?: typeof mockImageFolders;
}) {
  const [entries, setEntries] = useState(initial);
  const [selectedRef, setSelectedRef] = useState<string | null>(
    initial[0]?.ref ?? null,
  );
  return (
    <div
      data-mode="dark"
      className="h-screen bg-bg-canvas p-6 font-sans text-fg-primary"
    >
      <MediaCollection
        moduleFilePath={moduleFilePath}
        name={name}
        entries={entries}
        folders={folders}
        directory={directory}
        accept={accept}
        mode={mode}
        selectedRef={selectedRef}
        onSelect={setSelectedRef}
        onChangeEntry={(next) =>
          setEntries((current) =>
            current.map((entry) => (entry.ref === next.ref ? next : entry)),
          )
        }
        onDelete={(ref) => {
          setEntries((current) => current.filter((entry) => entry.ref !== ref));
          setSelectedRef(null);
        }}
        onUpload={() => undefined}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    </div>
  );
}

/**
 * `s.images()` open as a module: the collection an editor manages.
 *
 * Alt text and the focal point are edited here because they belong to the
 * image — every field pointing at it starts from what this says.
 */
export const ImagesCollection: Story = {
  render: () => (
    <CollectionHarness
      mode="manage"
      entries={mockImages}
      name="Media"
      moduleFilePath="/content/media.val.ts"
      directory="/public/val/images"
      accept="image/*"
      folders={mockImageFolders}
    />
  ),
};

/** The same module opened from a field: one item to take, then out. */
export const ImagesCollectionBrowsing: Story = {
  render: () => (
    <CollectionHarness
      mode="browse"
      entries={mockImages}
      name="Media"
      moduleFilePath="/content/media.val.ts"
      directory="/public/val/images"
      accept="image/*"
      folders={mockImageFolders}
    />
  ),
};

/** `s.files()`: no thumbnails, no alt text, no focal point. */
export const FilesCollection: Story = {
  render: () => (
    <CollectionHarness
      mode="manage"
      entries={mockFiles}
      name="Documents"
      moduleFilePath="/content/documents.val.ts"
      directory="/public/val/files"
      accept="application/*"
      folders={mockFileFolders}
    />
  ),
};

export const FilesCollectionBrowsing: Story = {
  render: () => (
    <CollectionHarness
      mode="browse"
      entries={mockFiles}
      name="Documents"
      moduleFilePath="/content/documents.val.ts"
      directory="/public/val/files"
      accept="application/*"
    />
  ),
};

/** A collection with nothing in it yet. */
export const CollectionEmpty: Story = {
  render: () => (
    <CollectionHarness
      mode="manage"
      entries={[]}
      name="Media"
      moduleFilePath="/content/media.val.ts"
      directory="/public/val/images"
      accept="image/*"
    />
  ),
};

/** Light mode, since both themes are first-class. */
export const ImageFieldLight: Story = {
  render: () => (
    <div
      data-mode="light"
      className="min-h-screen bg-bg-canvas p-6 font-sans text-fg-primary"
    >
      <div style={{ maxWidth: 560 }} className="mx-auto">
        <h1 className="text-[0.9375rem] font-semibold tracking-tight">
          s.image() — light
        </h1>
        <p className="mb-5 mt-1 text-xs leading-relaxed text-fg-secondary-alt">
          The same field in the light theme.
        </p>
        <OwnImageHarness start={mockImage} />
      </div>
    </div>
  ),
};

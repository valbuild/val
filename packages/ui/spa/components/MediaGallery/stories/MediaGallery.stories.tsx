import type { Meta, StoryObj } from "@storybook/react";
import { useRef, useState } from "react";
import type { SerializedVideoSchema, SourcePath } from "@valbuild/core";
import { VideoPlayer } from "../../fields/VideoPlayer";
import { VideoChoices } from "../../fields/VideoChoices";
import { MediaInspector } from "../MediaInspector";
import { fn } from "storybook/test";
import { MediaGallery } from "../MediaGallery";
import type { MediaGalleryProps, MediaItem } from "../types";

/**
 * The gallery for `s.videoset()`, `s.imageset()` and `s.fileset()`: one
 * layout for all three, a grid with the open entry in a panel beside it.
 *
 * The media is real (`.storybook/static/media`), so the player plays, the HLS
 * stream streams, and hovering a video tile previews it.
 */
const MEDIA = "/storybook-media";

const meta: Meta<typeof MediaGallery> = {
  title: "Components/MediaGallery",
  component: MediaGallery,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof MediaGallery>;

const videos: MediaItem[] = [
  {
    ref: "/public/val/videoset/intro_05198/master.m3u8",
    url: `${MEDIA}/intro_05198/master.m3u8`,
    name: "intro_05198",
    folder: "/val/videoset",
    mimeType: "application/vnd.apple.mpegurl",
    isHls: true,
    width: 640,
    height: 360,
    duration: 4,
    description: "The same test pattern, as a stream",
    thumbnailUrl: `${MEDIA}/intro-poster_a627f.webp`,
  },
  {
    ref: "/public/val/videoset/intro_51df2.mp4",
    url: `${MEDIA}/intro_51df2.mp4`,
    name: "intro_51df2.mp4",
    folder: "/val/videoset",
    mimeType: "video/mp4",
    width: 640,
    height: 360,
    duration: 4,
    description: "A colour test pattern with a moving gradient",
    thumbnailUrl: `${MEDIA}/intro-poster_a627f.webp`,
  },
  {
    // Uploaded before stills were stored: the tile seeks one second in.
    ref: "/public/val/videoset/clip-320x180_34a3a.webm",
    url: `${MEDIA}/clip-320x180.webm`,
    name: "clip-320x180_34a3a.webm",
    folder: "/val/videoset",
    mimeType: "video/webm",
    width: 320,
    height: 180,
    duration: 3,
    description: null,
  },
  {
    // A stream with no still: a placeholder until it is hovered.
    ref: "/public/val/videoset/office_1f2e3/master.m3u8",
    url: `${MEDIA}/intro_05198/master.m3u8`,
    name: "office_1f2e3",
    folder: "/val/videoset",
    mimeType: "application/vnd.apple.mpegurl",
    isHls: true,
    width: 640,
    height: 360,
    duration: 4,
    description: "Morning at the office",
  },
  {
    ref: "/public/val/videoset/broken_00000/master.m3u8",
    url: `${MEDIA}/intro_05198/master.m3u8`,
    name: "broken_00000",
    folder: "/val/videoset",
    mimeType: "application/vnd.apple.mpegurl",
    isHls: true,
    duration: 12,
    description: "A stream that lost a segment",
    thumbnailUrl: `${MEDIA}/intro-poster_a627f.webp`,
    errors: [
      "Video '/public/val/videoset/broken_00000/master.m3u8' is missing a file it names: /public/val/videoset/broken_00000/segments-2.mp4. It stops playing where they are. Upload it again, or put the files back.",
    ],
  },
];

const images: MediaItem[] = [
  {
    ref: "/public/val/gallery/brand-blue_9e87d.png",
    url: `${MEDIA}/brand-blue_9e87d.png`,
    name: "brand-blue_9e87d.png",
    folder: "/val/gallery",
    mimeType: "image/png",
    width: 320,
    height: 180,
    description: "A flat blue swatch",
    hotspot: { x: 0.3, y: 0.4 },
  },
  {
    ref: "/public/val/gallery/accent-amber_37f8b.png",
    url: `${MEDIA}/accent-amber_37f8b.png`,
    name: "accent-amber_37f8b.png",
    folder: "/val/gallery",
    mimeType: "image/png",
    width: 320,
    height: 180,
    description: "A flat amber swatch",
  },
  {
    ref: "/public/val/gallery/ink-slate_8154a.png",
    url: `${MEDIA}/ink-slate_8154a.png`,
    name: "ink-slate_8154a.png",
    folder: "/val/gallery",
    mimeType: "image/png",
    width: 320,
    height: 180,
    description: null,
  },
  {
    ref: "/public/val/gallery/intro-poster_a627f.webp",
    url: `${MEDIA}/intro-poster_a627f.webp`,
    name: "intro-poster_a627f.webp",
    folder: "/val/gallery",
    mimeType: "image/webp",
    width: 640,
    height: 360,
    description: "A still from the intro",
  },
];

const files: MediaItem[] = [
  {
    ref: "/public/val/files/handbook_a1b2c.pdf",
    url: "#",
    name: "handbook_a1b2c.pdf",
    folder: "/val/files",
    mimeType: "application/pdf",
    description: "The employee handbook",
  },
  {
    ref: "/public/val/files/intro-en_150f1.vtt",
    url: `${MEDIA}/intro-en_150f1.vtt`,
    name: "intro-en_150f1.vtt",
    folder: "/val/files",
    mimeType: "text/vtt",
  },
  {
    ref: "/public/val/files/prices_9f8e7.csv",
    url: "#",
    name: "prices_9f8e7.csv",
    folder: "/val/files",
    mimeType: "text/csv",
  },
];

/** Where each entry is used, as the Studio's references list would say. */
const usage: Record<string, string[]> = {
  "/public/val/videoset/intro_51df2.mp4": ["Showcase › From set"],
  "/public/val/videoset/intro_05198/master.m3u8": [
    "Showcase › Stream",
    "Home › Hero",
  ],
  "/public/val/gallery/brand-blue_9e87d.png": ["Media › From gallery"],
};

/**
 * The gallery with its state held here, as `ModuleGallery` will hold it:
 * selection, descriptions and renames all change what is shown.
 */
function Stateful(
  props: Omit<MediaGalleryProps, "selectedRef" | "onSelect"> & {
    initiallySelected?: string | null;
  },
) {
  const { initiallySelected = null, items: initial, ...rest } = props;
  const [items, setItems] = useState(initial);
  const [selectedRef, setSelectedRef] = useState(initiallySelected);
  return (
    <MediaGallery
      {...rest}
      items={items}
      selectedRef={selectedRef}
      onSelect={setSelectedRef}
      onDescriptionChange={(ref, description) => {
        rest.onDescriptionChange?.(ref, description);
        setItems((all) =>
          all.map((item) =>
            item.ref === ref ? { ...item, description } : item,
          ),
        );
      }}
      onRename={async (ref, newBase) => {
        await rest.onRename?.(ref, newBase);
        const renamed = (name: string) =>
          name.replace(/^.*?(_[0-9a-f]{5})/, `${newBase}$1`);
        setItems((all) =>
          all.map((item) =>
            item.ref === ref ? { ...item, name: renamed(item.name) } : item,
          ),
        );
        return null;
      }}
      onDelete={(ref) => {
        rest.onDelete?.(ref);
        setItems((all) => all.filter((item) => item.ref !== ref));
        setSelectedRef(null);
      }}
    />
  );
}

const handlers = {
  onUploadClick: fn(),
  onDescriptionChange: fn(),
  onRename: fn(async () => null),
  onDelete: fn(),
  deleteBlockedReason: (item: MediaItem) => {
    const places = usage[item.ref]?.length ?? 0;
    return places > 0
      ? `Used in ${places} ${places === 1 ? "place" : "places"}: remove it there first`
      : null;
  },
  renderUsage: (item: MediaItem) => {
    const places = usage[item.ref] ?? [];
    return places.length === 0 ? (
      <span className="text-xs italic text-fg-secondary-alt">Not used yet</span>
    ) : (
      <ul className="flex flex-col gap-1 text-xs text-fg-primary">
        {places.map((place) => (
          <li key={place} className="truncate">
            • {place}
          </li>
        ))}
      </ul>
    );
  },
};

/** A video set, with a stream open in the player. Hover a tile to preview. */
export const Videos: Story = {
  render: () => (
    <Stateful
      kind="videos"
      items={videos}
      initiallySelected={videos[0].ref}
      {...handlers}
    />
  ),
};

/** Nothing open: the grid takes the whole width. */
export const VideosNothingSelected: Story = {
  render: () => <Stateful kind="videos" items={videos} {...handlers} />,
};

/** Uploads in flight sit first in the grid, where they will land. */
export const VideosUploading: Story = {
  render: () => (
    <Stateful
      kind="videos"
      items={videos.slice(0, 2)}
      uploads={[
        { id: "1", name: "Team day.mov", phase: "converting", progress: 42 },
        { id: "2", name: "Launch.mp4", phase: "uploading", progress: 80 },
        { id: "3", name: "Office.mp4", phase: "reading", progress: null },
      ]}
      {...handlers}
    />
  ),
};

/** An entry with a problem: marked on its tile, explained in the panel. */
export const VideosWithAnError: Story = {
  render: () => (
    <Stateful
      kind="videos"
      items={videos}
      initiallySelected={videos[4].ref}
      {...handlers}
    />
  ),
};

/**
 * What the Studio's panel holds for a video: the player, and under it the
 * entry's defaults — the description, poster, start and end, focal point and
 * captions every field picked from the set starts from.
 */
export const VideosEditingDefaults: Story = {
  render: () => <EditingDefaults />,
};

function EditingDefaults() {
  const [selectedRef, setSelectedRef] = useState<string | null>(videos[1].ref);
  const videoRef = useRef<HTMLVideoElement>(null);
  const schema: SerializedVideoSchema = { type: "video", opt: false };
  return (
    <MediaGallery
      kind="videos"
      items={videos}
      selectedRef={selectedRef}
      onSelect={setSelectedRef}
      onUploadClick={fn()}
      renderInspector={(item, close) => (
        <MediaInspector
          kind="videos"
          item={item}
          onClose={close}
          hideDescription
          preview={
            <VideoPlayer
              ref={videoRef}
              src={item.url}
              isHls={!!item.isHls}
              poster={item.thumbnailUrl}
              className="aspect-video w-full rounded-md bg-black object-contain"
            />
          }
          defaults={
            <VideoChoices
              idBase={
                `/videos.val.ts?p=${JSON.stringify(item.ref)}` as SourcePath
              }
              own={{
                alt: item.description ?? undefined,
                posterTime: 1,
                ...(item.thumbnailUrl
                  ? { poster: { path: "/intro-poster_a627f.webp" } }
                  : {}),
              }}
              patchPath={[item.ref]}
              videoPath={item.ref}
              dir="/public/val/videoset"
              remote={null}
              schema={schema}
              videoRef={videoRef}
              canCapture
              urlOf={(media) => `${MEDIA}/${media.path.split("/").pop()}`}
              disabled={false}
              write={fn()}
              upload={async () => {}}
              onError={() => {}}
            />
          }
          onRename={async () => null}
          renameNote="Renaming updates the 1 place using it."
          usage={handlers.renderUsage(item)}
          onDelete={fn()}
          deleteBlockedReason={handlers.deleteBlockedReason(item)}
        />
      )}
    />
  );
}

/** The list, for a long set or a narrow window. */
export const VideosList: Story = {
  render: () => (
    <Stateful
      kind="videos"
      items={videos}
      defaultView="list"
      initiallySelected={videos[1].ref}
      {...handlers}
    />
  ),
};

/** What a file being dragged in looks like. */
export const VideosDraggingOver: Story = {
  render: () => (
    <Stateful kind="videos" items={videos} isDraggingOver {...handlers} />
  ),
};

export const VideosEmpty: Story = {
  render: () => <Stateful kind="videos" items={[]} {...handlers} />,
};

/** `.readonly()`: look, do not touch. */
export const VideosReadonly: Story = {
  render: () => (
    <Stateful
      kind="videos"
      items={videos}
      initiallySelected={videos[1].ref}
      readonly
      {...handlers}
    />
  ),
};

/** On a phone, the panel covers the grid instead of sitting beside it. */
export const VideosNarrow: Story = {
  render: () => (
    <div style={{ maxWidth: 390 }}>
      <Stateful
        kind="videos"
        items={videos}
        initiallySelected={videos[1].ref}
        {...handlers}
      />
    </div>
  ),
};

/** The same layout for an image set: the focal point is on the preview. */
export const Images: Story = {
  render: () => (
    <Stateful
      kind="images"
      items={images}
      initiallySelected={images[0].ref}
      {...handlers}
    />
  ),
};

/** And for a file set: the type, and Open. */
export const Files: Story = {
  render: () => (
    <Stateful
      kind="files"
      items={files}
      initiallySelected={files[0].ref}
      {...handlers}
    />
  ),
};

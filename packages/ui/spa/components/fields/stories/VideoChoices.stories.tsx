import type { Meta, StoryObj } from "@storybook/react";
import { useRef, useState } from "react";
import type { SerializedVideoSchema, SourcePath } from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import { applyPatch, JSONOps } from "@valbuild/core/patch";
import { result } from "@valbuild/core/fp";
import { VideoPlayer } from "../VideoPlayer";
import {
  effectiveChoices,
  VideoChoices,
  videoChoicesOf,
  type VideoChoicesValue,
} from "../VideoChoices";

/**
 * What one page chooses about a video — description, poster, start and end,
 * focal point, captions — edited with one set of controls wherever it is
 * chosen: on a video field, and on a set's entry, where the same choices are
 * the DEFAULTS every field picked from the set starts from.
 *
 * A field picked from a set shows the set's value until it sets its own, and
 * says so per value: "From gallery · Override", "Overridden · Use gallery's".
 */
const MEDIA = "/storybook-media";
const schema: SerializedVideoSchema = { type: "video", opt: false };

const meta: Meta<typeof VideoChoices> = {
  title: "Fields/VideoChoices",
  component: VideoChoices,
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof VideoChoices>;

const setEntry: VideoChoicesValue = {
  alt: "A colour test pattern with a moving gradient",
  poster: { path: "/intro-poster_a627f.webp", width: 640, height: 360 },
  posterTime: 1,
  startTime: 0.5,
  endTime: 3.5,
  hotspot: { x: 0.3, y: 0.6 },
  captions: [{ path: "/intro-en_150f1.vtt", srclang: "en", label: "English" }],
};

/** Served from the story's static media, by the name in the path. */
const urlOf = (media: { path: string }) =>
  `${MEDIA}/${media.path.split("/").pop()}`;

/**
 * The editor with its state held here, as the Studio's store would: each
 * patch is applied to the value, so Override and "Use gallery's" do what
 * they say.
 */
function Editor({
  initial,
  inherited,
}: {
  initial: VideoChoicesValue;
  inherited: VideoChoicesValue | null;
}) {
  const [own, setOwn] = useState<VideoChoicesValue>(initial);
  const videoRef = useRef<HTMLVideoElement>(null);
  const write = (patch: Patch) => {
    const res = applyPatch(
      JSON.parse(JSON.stringify(own)),
      new JSONOps(),
      patch,
    );
    if (result.isOk(res)) {
      setOwn(videoChoicesOf(res.value));
    }
  };
  const shown = effectiveChoices(own, inherited);
  return (
    <div className="flex max-w-md flex-col gap-5">
      <VideoPlayer
        ref={videoRef}
        src={`${MEDIA}/intro_51df2.mp4`}
        isHls={false}
        poster={shown.poster ? urlOf(shown.poster) : undefined}
        startTime={shown.startTime}
        endTime={shown.endTime}
        className="aspect-video w-full rounded-md bg-black object-contain"
      />
      <VideoChoices
        idBase={'/content/page.val.ts?p="hero"' as SourcePath}
        own={own}
        inherited={inherited}
        patchPath={[]}
        videoPath="/public/val/videoset/intro_51df2.mp4"
        dir="/public/val/videoset"
        remote={null}
        schema={schema}
        videoRef={videoRef}
        canCapture={false}
        urlOf={urlOf}
        disabled={false}
        write={write}
        upload={async () => {}}
        onError={() => {}}
      />
    </div>
  );
}

/** A field picked from a set, with nothing of its own: all the set's. */
export const FromTheSet: Story = {
  render: () => <Editor initial={{}} inherited={setEntry} />,
};

/** The same field after overriding the description and the start. */
export const PartlyOverridden: Story = {
  render: () => (
    <Editor
      initial={{ alt: "The intro, from the second beat", startTime: 1.5 }}
      inherited={setEntry}
    />
  ),
};

/** A set's entry, or a video field with its own file: nothing to inherit. */
export const OwnChoices: Story = {
  render: () => <Editor initial={setEntry} inherited={null} />,
};

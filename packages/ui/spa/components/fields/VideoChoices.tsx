import { Internal, SourcePath } from "@valbuild/core";
import type {
  SerializedVideoSchema,
  VideoCaptionSource,
  VideoPosterSource,
} from "@valbuild/core";
import type { JSONValue, Patch } from "@valbuild/core/patch";
import { array } from "@valbuild/core/fp";
import { Captions, X } from "lucide-react";
import { ReactNode, RefObject, useRef, useState } from "react";
import { Button } from "../designSystem/button";
import { Checkbox } from "../designSystem/checkbox";
import { Input } from "../designSystem/input";
import { MediaThumbnail } from "../MediaThumbnail";
import { FocalPointPicker } from "./FocalPointPicker";
import { InheritedNote, type Inheritance } from "./InheritedNote";
import { Section } from "./MediaSummaryRow";
import {
  bytesToBase64,
  createCaptionPatch,
  createPosterPatch,
  localPathOf,
  roundTime,
  toJson,
  type PosterUpload,
  type RemoteUploadConfig,
} from "../../utils/video/createVideoPatch";
import {
  captureFrameFromElement,
  type CapturedFrame,
} from "../../utils/video/readVideo";
import { sha256Hex } from "../../utils/video/sha256";
import { isVtt, srtToVtt } from "../../utils/video/srtToVtt";

/**
 * What one page chooses about a video, as opposed to what is true of the
 * file: the description, the poster, the start and end, the focal point and
 * the captions — `VideoDefaults` and `alt` in core.
 *
 * A video field holds these for itself. A set's entry holds them as the
 * DEFAULTS every field picked from the set starts from, and a field overrides
 * them key by key (`fillFromGallery`). Both are edited with the same controls,
 * which is what this is.
 */
export type VideoChoicesValue = {
  alt?: string;
  hotspot?: { x: number; y: number };
  posterTime?: number;
  poster?: VideoPosterSource;
  startTime?: number;
  endTime?: number;
  captions?: readonly VideoCaptionSource[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function posterOf(value: unknown): VideoPosterSource | undefined {
  if (!isRecord(value) || typeof value.path !== "string") {
    return undefined;
  }
  const width = numberOrUndefined(value.width);
  const height = numberOrUndefined(value.height);
  const mimeType = stringOrUndefined(value.mimeType);
  const patchId = stringOrUndefined(value.patch_id);
  return {
    path: value.path,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(mimeType !== undefined ? { mimeType } : {}),
    ...(patchId !== undefined ? { patch_id: patchId } : {}),
  };
}

function captionOf(value: unknown): VideoCaptionSource | undefined {
  if (
    !isRecord(value) ||
    typeof value.path !== "string" ||
    typeof value.srclang !== "string"
  ) {
    return undefined;
  }
  const label = stringOrUndefined(value.label);
  const patchId = stringOrUndefined(value.patch_id);
  return {
    path: value.path,
    srclang: value.srclang,
    ...(label !== undefined ? { label } : {}),
    ...(value.kind === "captions" || value.kind === "subtitles"
      ? { kind: value.kind }
      : {}),
    ...(typeof value.default === "boolean" ? { default: value.default } : {}),
    ...(patchId !== undefined ? { patch_id: patchId } : {}),
  };
}

/**
 * The choices in a value read from a module — a field's or a set entry's —
 * checked rather than asserted: a draft is whatever the patches made it.
 */
export function videoChoicesOf(value: unknown): VideoChoicesValue {
  if (!isRecord(value)) {
    return {};
  }
  const hotspot =
    isRecord(value.hotspot) &&
    typeof value.hotspot.x === "number" &&
    typeof value.hotspot.y === "number"
      ? { x: value.hotspot.x, y: value.hotspot.y }
      : undefined;
  const choices: VideoChoicesValue = {};
  const alt = stringOrUndefined(value.alt);
  if (alt !== undefined) choices.alt = alt;
  if (hotspot) choices.hotspot = hotspot;
  const posterTime = numberOrUndefined(value.posterTime);
  if (posterTime !== undefined) choices.posterTime = posterTime;
  const poster = posterOf(value.poster);
  if (poster) choices.poster = poster;
  const startTime = numberOrUndefined(value.startTime);
  if (startTime !== undefined) choices.startTime = startTime;
  const endTime = numberOrUndefined(value.endTime);
  if (endTime !== undefined) choices.endTime = endTime;
  if (Array.isArray(value.captions)) {
    choices.captions = value.captions.flatMap((track) => {
      const caption = captionOf(track);
      return caption ? [caption] : [];
    });
  }
  return choices;
}

/** The files a value's choices name: its poster and its caption tracks. */
export function filesOfChoices(value: unknown): string[] {
  const { poster, captions } = videoChoicesOf(value);
  return [
    ...(poster ? [poster.path] : []),
    ...(captions ?? []).map((track) => track.path),
  ];
}

/**
 * What the page will play: the field's own choices, and the set's where it
 * has none — group by group, as `fillFromGallery` merges them, because that
 * is the merge a page gets and the Studio must not show a different one.
 */
export function effectiveChoices(
  own: VideoChoicesValue,
  inherited: VideoChoicesValue | null | undefined,
): VideoChoicesValue {
  if (!inherited) {
    return own;
  }
  const merged: Record<string, unknown> = { ...own };
  const fromSet: Record<string, unknown> = { ...inherited };
  for (const group of Internal.media.GALLERY_DEFAULT_GROUPS) {
    if (group.some((key) => merged[key] !== undefined)) {
      continue;
    }
    for (const key of group) {
      if (fromSet[key] !== undefined) {
        merged[key] = fromSet[key];
      }
    }
  }
  return videoChoicesOf(merged);
}

type Group =
  | "alt"
  | "hotspot"
  | "poster"
  | "startTime"
  | "endTime"
  | "captions";

/** The keys each section writes, in the groups `fillFromGallery` merges. */
const GROUP_KEYS: Record<Group, (keyof VideoChoicesValue)[]> = {
  alt: ["alt"],
  hotspot: ["hotspot"],
  poster: ["poster", "posterTime"],
  startTime: ["startTime"],
  endTime: ["endTime"],
  captions: ["captions"],
};

function inheritanceOf(
  group: Group,
  own: VideoChoicesValue,
  inherited: VideoChoicesValue | null | undefined,
): Inheritance {
  if (!inherited) {
    return "own";
  }
  const keys = GROUP_KEYS[group];
  const hasOwn = keys.some((key) => own[key] !== undefined);
  const hasInherited = keys.some((key) => inherited[key] !== undefined);
  if (!hasInherited) {
    return "own";
  }
  return hasOwn ? "overridden" : "inherited";
}

/** A plain JSON copy of a choice, as a patch carries it. */
function jsonOf(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value));
}

/** A copy without the `patch_id` the server put on a draft file. */
function withoutPatchId<T extends { patch_id?: string }>(
  value: T,
): Omit<T, "patch_id"> {
  const { patch_id: _patchId, ...rest } = value;
  return rest;
}

export function VideoChoices({
  idBase,
  own,
  inherited,
  inheritedFrom = "gallery",
  patchPath,
  videoPath,
  dir,
  remote,
  schema,
  videoRef,
  canCapture,
  urlOf,
  disabled,
  write,
  upload,
  onError,
}: {
  /** Where the elements' ids are made from: the field's or the entry's path. */
  idBase: SourcePath;
  /** What is written at `patchPath`. */
  own: VideoChoicesValue;
  /**
   * The set entry's choices, for a field picked from a set: what the field
   * shows until it sets its own. `null` for a field with its own file, and for
   * the entry itself.
   */
  inherited?: VideoChoicesValue | null;
  /** What the default comes from, in "From …" and "Use …'s". */
  inheritedFrom?: string;
  patchPath: string[];
  /** The video's own path, which the poster's file name is made from. */
  videoPath: string;
  dir: string;
  remote: RemoteUploadConfig | null;
  /** What a poster's and a caption's remote validation hash is made from. */
  schema: SerializedVideoSchema;
  /** The player, for "use current frame" and "use current time". */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** The player has the stored video loaded, so a frame of it can be taken. */
  canCapture: boolean;
  urlOf: (media: { path: string; patch_id?: string }) => string;
  disabled: boolean;
  write: (patch: Patch) => void;
  /** For a patch with file ops; resolves when it is done, failed or not. */
  upload: (patch: Patch) => Promise<unknown>;
  onError: (message: string | null) => void;
}) {
  const captionInputRef = useRef<HTMLInputElement>(null);
  const shown = effectiveChoices(own, inherited);
  const status = (group: Group) => inheritanceOf(group, own, inherited);
  /** A control is editable when the value it shows is this one's to change. */
  const locked = (group: Group) => disabled || status(group) === "inherited";

  const setKey = (
    key: "alt" | "posterTime" | "startTime" | "endTime" | "hotspot",
    value: string | number | { x: number; y: number } | undefined,
  ) => {
    const keyPath = patchPath.concat(key);
    if (value === undefined) {
      if (own[key] !== undefined && array.isNonEmpty(keyPath)) {
        write([{ op: "remove", path: keyPath }]);
      }
      return;
    }
    // "add", never "replace": on an object key it is create-or-set, so it
    // survives the key having gone away meanwhile. See `ImageField`'s alt.
    write([{ op: "add", path: keyPath, value }]);
  };

  /** Take the set's value as this field's own, to change from there. */
  const override = (group: Group) => {
    if (!inherited) return;
    const patch: Patch = [];
    for (const key of GROUP_KEYS[group]) {
      const value = inherited[key];
      if (value === undefined) continue;
      patch.push({
        op: "add",
        path: patchPath.concat(key),
        value:
          key === "poster" && inherited.poster
            ? toJson(withoutPatchId(inherited.poster))
            : key === "captions" && inherited.captions
              ? toJson(inherited.captions.map(withoutPatchId))
              : jsonOf(value),
      });
    }
    if (patch.length > 0) write(patch);
  };

  /** Drop this field's own value, so the set's shows through again. */
  const useInherited = (group: Group) => {
    const patch: Patch = [];
    for (const key of GROUP_KEYS[group]) {
      const keyPath = patchPath.concat(key);
      if (own[key] !== undefined && array.isNonEmpty(keyPath)) {
        patch.push({ op: "remove", path: keyPath });
      }
    }
    if (patch.length > 0) write(patch);
  };

  const aside = (group: Group) => (
    <InheritedNote
      inheritance={status(group)}
      from={inheritedFrom}
      disabled={disabled}
      onOverride={() => override(group)}
      onUseInherited={() => useInherited(group)}
    />
  );

  const takePoster = async () => {
    const video = videoRef.current;
    if (!video) return;
    onError(null);
    try {
      const frame = await captureFrameFromElement(video);
      await upload(
        createPosterPatch({
          patchPath,
          dir,
          videoPath,
          poster: await toPosterUpload(frame),
          posterTime: video.currentTime,
          remote,
          schema,
        }),
      );
    } catch (err) {
      onError(
        `Could not take a poster from this frame: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const addCaptions = async (file: File) => {
    onError(null);
    try {
      const text = await file.text();
      const vtt = isVtt(text) ? text : srtToVtt(text);
      const bytes = new TextEncoder().encode(vtt);
      const dataUrl = `data:text/vtt;base64,${bytesToBase64(bytes)}`;
      const srclang = guessLanguage(file.name) ?? "";
      const name = file.name.replace(/\.(srt|vtt)$/i, "") + ".vtt";
      await upload(
        createCaptionPatch({
          patchPath,
          dir,
          filename: name,
          file: {
            bytes,
            dataUrl,
            mimeType: "text/vtt",
            sha256: await sha256Hex(bytes),
          },
          track: {
            srclang,
            label: file.name.replace(/\.(srt|vtt)$/i, ""),
          },
          existing: own.captions,
          remote,
          schema,
        }),
      );
    } catch (err) {
      onError(
        `Could not add the captions: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const setCaption = (
    index: number,
    key: "srclang" | "label" | "kind" | "default",
    value: string | boolean | undefined,
  ) => {
    const keyPath = patchPath.concat("captions", String(index), key);
    if (value === undefined) {
      if (array.isNonEmpty(keyPath)) {
        write([{ op: "remove", path: keyPath }]);
      }
      return;
    }
    const ops: Patch = [{ op: "add", path: keyPath, value }];
    // One default at a time: turning one on turns the others off in the same
    // patch, so there is never a moment where two are.
    if (key === "default" && value === true) {
      own.captions?.forEach((track, i) => {
        if (i !== index && track.default) {
          ops.push({
            op: "add",
            path: patchPath.concat("captions", String(i), "default"),
            value: false,
          });
        }
      });
    }
    write(ops);
  };

  const removeCaption = (index: number) => {
    const keyPath = patchPath.concat("captions", String(index));
    if (array.isNonEmpty(keyPath)) {
      write([{ op: "remove", path: keyPath }]);
    }
  };

  const posterUrl = shown.poster ? urlOf(shown.poster) : null;

  return (
    <>
      <Section
        label="Description"
        hint="What happens in the video, for people who cannot see it."
        aside={aside("alt")}
      >
        <Input
          id={Internal.createValPathOfItem(idBase, "alt")}
          value={shown.alt ?? ""}
          disabled={locked("alt")}
          placeholder="What happens in the video..."
          onChange={(ev) => setKey("alt", ev.target.value)}
        />
      </Section>
      {/*
       * The poster is shown here, beside the control that sets it — not as
       * the card's thumbnail, where it read as the video itself.
       */}
      <Section
        label="Poster"
        hint="The still shown before the video plays. Pause the video on the frame you want, then use it."
        aside={aside("poster")}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative h-[5.625rem] w-40 shrink-0 overflow-hidden rounded-md border border-border-primary bg-bg-secondary">
            {posterUrl ? (
              <MediaThumbnail
                url={posterUrl}
                alt={shown.alt}
                hotspot={shown.hotspot}
              />
            ) : (
              <span className="grid h-full place-items-center text-[0.6875rem] text-fg-secondary-alt">
                No poster
              </span>
            )}
          </div>
          <div className="flex flex-col items-start gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={locked("poster") || !canCapture}
              onClick={takePoster}
            >
              Use current frame
            </Button>
            <span className="text-xs text-fg-secondary">
              {typeof shown.posterTime === "number"
                ? `Taken at ${formatTime(shown.posterTime)}`
                : "Not set"}
            </span>
          </div>
        </div>
      </Section>
      <Section
        label="Start and end"
        hint="Play only part of the video. The file is not cut; the page starts and stops playback here."
        collapsible
        summary={
          shown.startTime !== undefined || shown.endTime !== undefined
            ? `${formatTime(shown.startTime ?? 0)} – ${
                shown.endTime !== undefined ? formatTime(shown.endTime) : "end"
              }`
            : "Whole video"
        }
      >
        {/* Overridden one at a time, so each says where it comes from. */}
        <div className="grid grid-cols-2 gap-3">
          <TimeInput
            label="Start"
            value={shown.startTime}
            disabled={locked("startTime")}
            note={inherited ? aside("startTime") : null}
            onChange={(value) => setKey("startTime", value)}
            onUseCurrent={() =>
              videoRef.current &&
              setKey("startTime", roundTime(videoRef.current.currentTime))
            }
          />
          <TimeInput
            label="End"
            value={shown.endTime}
            disabled={locked("endTime")}
            note={inherited ? aside("endTime") : null}
            onChange={(value) => setKey("endTime", value)}
            onUseCurrent={() =>
              videoRef.current &&
              setKey("endTime", roundTime(videoRef.current.currentTime))
            }
          />
        </div>
      </Section>
      <Section
        label="Focal point"
        hint={
          posterUrl
            ? "Click or drag on the poster to say what must stay in frame when the page crops the video."
            : "Set a poster first: the focal point is chosen on it."
        }
        collapsible
        aside={aside("hotspot")}
        summary={
          shown.hotspot
            ? `${Math.round(shown.hotspot.x * 100)}%, ${Math.round(shown.hotspot.y * 100)}%`
            : "Not set"
        }
      >
        {posterUrl && (
          <FocalPointPicker
            url={posterUrl}
            hotspot={shown.hotspot}
            alt={shown.alt}
            readonly={locked("hotspot")}
            id={Internal.createValPathOfItem(idBase, "hotspot")}
            onChange={(hotspot) => setKey("hotspot", hotspot)}
          />
        )}
        {own.hotspot && (
          <Button
            className="mt-2"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => setKey("hotspot", undefined)}
          >
            Clear focal point
          </Button>
        )}
      </Section>
      <Section
        label="Captions"
        hint="WebVTT (.vtt) or SubRip (.srt) files, one per language. .srt is converted to .vtt."
        aside={aside("captions")}
      >
        <div className="flex flex-col gap-3">
          {shown.captions?.map((track, index) => (
            <CaptionRow
              key={`${index}:${track.path}`}
              track={track}
              idBase={idBase}
              index={index}
              disabled={locked("captions")}
              onChange={(key, value) => setCaption(index, key, value)}
              onRemove={() => removeCaption(index)}
            />
          ))}
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={locked("captions")}
              onClick={() => captionInputRef.current?.click()}
            >
              <Captions className="mr-1.5 h-3.5 w-3.5" />
              Add captions
            </Button>
          </div>
          <input
            hidden
            ref={captionInputRef}
            type="file"
            accept=".vtt,.srt,text/vtt"
            disabled={locked("captions")}
            onChange={(ev) => {
              const file = ev.currentTarget.files?.[0];
              if (file) {
                addCaptions(file);
              }
              ev.target.value = "";
            }}
          />
        </div>
      </Section>
    </>
  );
}

function CaptionRow({
  track,
  idBase,
  index,
  disabled,
  onChange,
  onRemove,
}: {
  track: VideoCaptionSource;
  idBase: SourcePath;
  index: number;
  disabled: boolean;
  onChange: (
    key: "srclang" | "label" | "kind" | "default",
    value: string | boolean | undefined,
  ) => void;
  onRemove: () => void;
}) {
  const id = `${idBase}:captions:${index}`;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-primary p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-fg-secondary">
          {localPathOf(track.path).split("/").pop()}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={onRemove}
          aria-label="Remove caption track"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="grid grid-cols-[6rem_1fr] gap-2">
        <label className="flex flex-col gap-1 text-xs text-fg-secondary">
          Language
          <Input
            value={track.srclang}
            placeholder="en"
            disabled={disabled}
            onChange={(ev) => onChange("srclang", ev.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-secondary">
          Label
          <Input
            value={track.label ?? ""}
            placeholder="English"
            disabled={disabled}
            onChange={(ev) =>
              onChange(
                "label",
                ev.target.value === "" ? undefined : ev.target.value,
              )
            }
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-4">
        <span className="flex items-center gap-2">
          <Checkbox
            id={`${id}:kind`}
            checked={track.kind === "captions"}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange("kind", checked ? "captions" : undefined)
            }
          />
          <label htmlFor={`${id}:kind`} className="text-xs text-fg-secondary">
            Describes sounds too
          </label>
        </span>
        <span className="flex items-center gap-2">
          <Checkbox
            id={`${id}:default`}
            checked={!!track.default}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange("default", checked ? true : undefined)
            }
          />
          <label
            htmlFor={`${id}:default`}
            className="text-xs text-fg-secondary"
          >
            On by default
          </label>
        </span>
      </div>
    </div>
  );
}

/**
 * Seconds, typed as `1:05.5` or `65.5`, written when the input loses focus —
 * a half-typed time is not a time, and writing one would trip validation on
 * every keystroke.
 */
function TimeInput({
  label,
  value,
  disabled,
  note,
  onChange,
  onUseCurrent,
}: {
  label: string;
  value: number | undefined;
  disabled: boolean;
  note?: ReactNode;
  onChange: (value: number | undefined) => void;
  onUseCurrent: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value !== undefined ? formatTime(value) : "");
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1 text-xs text-fg-secondary">
        {label}
        <Input
          value={shown}
          placeholder={label === "Start" ? "0:00" : "end"}
          disabled={disabled}
          onChange={(ev) => setDraft(ev.target.value)}
          onBlur={() => {
            if (draft === null) return;
            const parsed = parseTime(draft);
            setDraft(null);
            if (parsed === null) return;
            onChange(parsed === undefined ? undefined : roundTime(parsed));
          }}
        />
      </label>
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        disabled={disabled}
        onClick={onUseCurrent}
      >
        Use current time
      </Button>
      {note}
    </div>
  );
}

/** `m:ss.cc` — the hundredths only when there are any. */
export function formatTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  const whole = Math.floor(rest);
  const hundredths = Math.round((rest - whole) * 100);
  const base = `${minutes}:${String(whole).padStart(2, "0")}`;
  return hundredths > 0
    ? `${base}.${String(hundredths).padStart(2, "0")}`
    : base;
}

/**
 * `undefined` for an emptied input (clear the time), `null` for something
 * that is not a time (leave it as it was).
 */
export function parseTime(text: string): number | undefined | null {
  const trimmed = text.trim();
  if (trimmed === "") {
    return undefined;
  }
  const parts = trimmed.split(":");
  if (parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) {
    return null;
  }
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

/** `intro.en.vtt` / `intro_nb-NO.srt` name their language often enough. */
function guessLanguage(filename: string): string | null {
  const match = /[._-]([a-z]{2}(?:-[A-Z]{2})?)\.(vtt|srt)$/.exec(filename);
  return match ? match[1] : null;
}

export async function toPosterUpload(
  frame: CapturedFrame,
): Promise<PosterUpload> {
  return {
    bytes: frame.bytes,
    dataUrl: frame.dataUrl,
    mimeType: frame.mimeType,
    sha256: await sha256Hex(frame.bytes),
    width: frame.width,
    height: frame.height,
  };
}

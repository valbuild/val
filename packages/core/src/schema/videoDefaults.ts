import type { VideoDefaults } from "../source/media";
import { filenameToMimeType } from "../mimeType";
import type { ValidationError } from "./validation/ValidationError";

/**
 * The checks of what one page chose about a video — its times, focal point,
 * poster and captions — shared by the two places those choices are made: a
 * field (`s.video()`) and the entry of a set (`s.videoset()`), which holds the
 * same choices as the defaults every field picked from it starts from.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripQuery(path: string): string {
  return path.split("?")[0];
}

/**
 * What is checked, typed as what it IS rather than what it should be: a
 * field's value and a set's entry both reach here from hand-written JSON
 * that never saw the type.
 */
type Authored = { readonly [K in keyof VideoDefaults]?: unknown };

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function validateTimes(
  src: Authored,
  duration: number | undefined,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const key of ["posterTime", "startTime", "endTime"] as const) {
    const value = src[key];
    if (value === undefined) {
      continue;
    }
    if (!isNonNegativeNumber(value)) {
      errors.push({
        message: `'${key}' must be a number of seconds, 0 or more. Got: ${JSON.stringify(value)}`,
        value: src,
      });
    } else if (duration !== undefined && value > duration) {
      errors.push({
        message: `'${key}' (${value}s) is after the end of the video (${duration}s).`,
        value: src,
      });
    }
  }
  const { startTime, endTime } = src;
  if (
    isNonNegativeNumber(startTime) &&
    isNonNegativeNumber(endTime) &&
    startTime >= endTime
  ) {
    errors.push({
      message: `'startTime' (${startTime}s) must be before 'endTime' (${endTime}s).`,
      value: src,
    });
  }
  return errors;
}

export function validateHotspot(src: Authored): ValidationError[] {
  if (src.hotspot === undefined) {
    return [];
  }
  const { hotspot } = src;
  if (
    !isRecord(hotspot) ||
    typeof hotspot.x !== "number" ||
    typeof hotspot.y !== "number" ||
    hotspot.x < 0 ||
    hotspot.x > 1 ||
    hotspot.y < 0 ||
    hotspot.y > 1
  ) {
    return [
      {
        message: `'hotspot' must be { x, y } with both between 0 and 1.`,
        value: src,
      },
    ];
  }
  return [];
}

export function validatePoster(src: Authored): ValidationError[] {
  if (src.poster === undefined) {
    return [];
  }
  const { poster } = src;
  if (!isRecord(poster) || typeof poster.path !== "string") {
    return [
      {
        message: `'poster' must be an image object with a 'path'.`,
        value: src,
      },
    ];
  }
  const mimeType = filenameToMimeType(stripQuery(poster.path));
  if (!mimeType || !mimeType.startsWith("image/")) {
    return [
      {
        message: `The poster must be an image. Got: ${poster.path}`,
        value: src,
      },
    ];
  }
  return [];
}

const CAPTION_KINDS = ["subtitles", "captions"];

export function validateCaptions(src: Authored): ValidationError[] {
  if (src.captions === undefined) {
    return [];
  }
  if (!Array.isArray(src.captions)) {
    return [{ message: `'captions' must be an array.`, value: src }];
  }
  const errors: ValidationError[] = [];
  let defaults = 0;
  const seen = new Set<string>();
  src.captions.forEach((track: unknown, i) => {
    const at = `Caption track ${i + 1}`;
    if (!isRecord(track)) {
      errors.push({ message: `${at} must be an object.`, value: src });
      return;
    }
    const t = track;
    if (typeof t.path !== "string") {
      errors.push({ message: `${at} has no 'path'.`, value: src });
    } else if (filenameToMimeType(stripQuery(t.path)) !== "text/vtt") {
      errors.push({
        message: `${at} must be a WebVTT (.vtt) file. Got: ${t.path}`,
        value: src,
      });
    }
    if (typeof t.srclang !== "string" || t.srclang.trim() === "") {
      errors.push({
        message: `${at} needs a language ('srclang'), e.g. "en".`,
        value: src,
      });
    }
    if (t.label !== undefined && typeof t.label !== "string") {
      errors.push({ message: `${at}: 'label' must be a string.`, value: src });
    }
    if (
      t.kind !== undefined &&
      (typeof t.kind !== "string" || !CAPTION_KINDS.includes(t.kind))
    ) {
      errors.push({
        message: `${at}: 'kind' must be "subtitles" or "captions".`,
        value: src,
      });
    }
    if (t.default !== undefined && typeof t.default !== "boolean") {
      errors.push({
        message: `${at}: 'default' must be true or false.`,
        value: src,
      });
    }
    if (t.default === true) {
      defaults++;
    }
    if (typeof t.srclang === "string") {
      const key = `${t.kind ?? "subtitles"}:${t.srclang}`;
      if (seen.has(key)) {
        errors.push({
          message: `${at} repeats the language '${t.srclang}'.`,
          value: src,
        });
      }
      seen.add(key);
    }
  });
  if (defaults > 1) {
    errors.push({
      message: `At most one caption track can be the default. ${defaults} are.`,
      value: src,
    });
  }
  return errors;
}

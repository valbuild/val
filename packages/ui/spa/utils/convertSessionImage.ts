import { z } from "zod";
import type { AITool } from "../hooks/useAIWebSocket";
import { ENCODE_DEFAULTS, type EncodeSettings } from "./encodeImage";

/**
 * `convert_session_image`: an image in the chat, made WebP and no bigger than
 * asked, as a NEW image in the chat. For the assistant to make an image fit
 * where it is going -- a gallery that takes only WebP, a field with a size
 * limit -- before it puts it there.
 *
 * The Studio's own encoder does it (`encodeImage`, the one an upload goes
 * through), so it is what a person uploading the same file would get. It
 * works on the files this tab put in the chat: the session keeps the bytes
 * on the server, which this tab cannot read back.
 */
export const CONVERT_SESSION_IMAGE_TOOL: AITool = {
  name: "convert_session_image",
  description:
    "Convert an image in this chat to WebP and/or scale it down to fit within max_width x max_height, as a NEW image in the chat. " +
    "Returns its image_key: use that one from then on (e.g. with add_session_image_to_gallery or in a sketchpad as session:<image_key>). " +
    "Use it when an image must be WebP or smaller to go where it is going. If converting would only make it bigger, the original is kept and you are told so.",
  parameters: {
    type: "object",
    properties: {
      image_key: {
        type: "string",
        description: "The image_key of an image in this chat.",
      },
      max_width: {
        type: "number",
        description: `Pixels. Default ${ENCODE_DEFAULTS.maxWidth}.`,
      },
      max_height: {
        type: "number",
        description: `Pixels. Default ${ENCODE_DEFAULTS.maxHeight}.`,
      },
      quality: {
        type: "number",
        description: `0 to 1. Default ${ENCODE_DEFAULTS.quality}.`,
      },
    },
    required: ["image_key"],
  },
};

const Args = z.object({
  image_key: z.string(),
  max_width: z.number().positive().optional(),
  max_height: z.number().positive().optional(),
  quality: z.number().gt(0).max(1).optional(),
});

export type ConvertOutcome = { result: unknown; isError: boolean };

export async function runConvertSessionImage(
  args: unknown,
  deps: {
    /** The files this tab put in the chat, by image_key. */
    files: ReadonlyMap<string, File>;
    encode: (file: File, settings: EncodeSettings) => Promise<File>;
    upload: (file: File) => Promise<{ key: string }>;
  },
): Promise<ConvertOutcome> {
  const parsed = Args.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      result: {
        error: `convert_session_image: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
      },
    };
  }
  const { image_key, max_width, max_height, quality } = parsed.data;
  const file = deps.files.get(image_key);
  if (!file) {
    return {
      isError: true,
      result: {
        error:
          "That image was not put in the chat from this browser tab, so it cannot be converted here. Ask the person to attach it again, or use it as it is.",
        convertible: Array.from(deps.files.keys()),
      },
    };
  }
  const settings: EncodeSettings = {
    type: "webp",
    quality: quality ?? ENCODE_DEFAULTS.quality,
    maxWidth: Math.round(max_width ?? ENCODE_DEFAULTS.maxWidth),
    maxHeight: Math.round(max_height ?? ENCODE_DEFAULTS.maxHeight),
  };
  const converted = await deps.encode(file, settings);
  if (converted === file) {
    return {
      isError: false,
      result: {
        image_key,
        unchanged: true,
        note: "Kept as it was: it is already within the size, and converting it would not make it smaller (or it is SVG, GIF or AVIF, which are never converted).",
        mimeType: file.type,
      },
    };
  }
  const { key } = await deps.upload(converted);
  return {
    isError: false,
    result: {
      image_key: key,
      from: image_key,
      mimeType: converted.type,
      bytes: converted.size,
      originalBytes: file.size,
    },
  };
}

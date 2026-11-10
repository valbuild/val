import type {
  PageScreenshot,
  PageSnapshot,
  PickedElement,
} from "@valbuild/shared/internal";
import type { AITool } from "./useAIWebSocket";

/**
 * The page in the Studio's preview, as the assistant's tools see it: the
 * design tab's `read_page` and `screenshot_page` (`proposals/proposalCode.ts`
 * runs both), offered by the Studio's own assistant while the preview is
 * open beside it.
 *
 * Without `device`: in the Studio the preview's width is the person's
 * switch, and the assistant changing it under them would be a surprise.
 */
export const READ_PAGE_TOOL: AITool = {
  name: "read_page",
  description:
    "Read the page the preview beside the editor shows, as the person sees it: its headings, text, links, buttons, images (with alt text) and inputs in order, " +
    "each with its box (x, y, width, height in CSS pixels) and a selector. " +
    "With selector -- one from this answer, or from what the person picked -- that element in detail: its computed styles " +
    "(font, size, weight, colour, background, spacing, layout), how many lines its text wraps to, and its children. " +
    "picked: true reads the element the person picked. Content edits show on the page as they are made.",
  parameters: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description:
          "An element to read in detail, as this tool or <picked/> writes selectors.",
      },
      picked: {
        type: "boolean",
        description: "Read the element the person picked in the preview.",
      },
      max_items: {
        type: "number",
        description: "How many items of the outline at most (default 300).",
      },
    },
    required: [],
  },
};

export const SCREENSHOT_PAGE_TOOL: AITool = {
  name: "screenshot_page",
  description:
    "See the page the preview beside the editor shows: a picture of it, as the person sees it, attached to the answer. " +
    "What is on screen, or full_page: true for the whole page from the top (cut off below 4000px). " +
    "It is drawn from the page's HTML and CSS, so images from other sites, videos, canvases and embeds may come out blank: " +
    "that is the picture, not the page. Use read_page for exact text, sizes and styles.",
  parameters: {
    type: "object",
    properties: {
      full_page: {
        type: "boolean",
        description: "The whole page from the top, not only what is on screen.",
      },
    },
    required: [],
  },
};

/** What the tools answer while the preview is closed. */
export const NO_PREVIEW =
  "The preview is not open, so there is no page to read. Ask the person to open it with the Preview button at the top, and try again.";

/**
 * What the system prompt says about the page: once a preview is open, or a
 * message points at something on it.
 */
export const PAGE_PROMPT_SECTION = `

## The page in the preview
The person may have the site's page open in a preview beside the editor, and the page shows content edits as they are made.
- <picked .../> at the end of a message is what the person pointed you at on that page, with the Select in your header, and "this" or "here" in the message means it. It names the element's tag, its classes, a selector from the page's body, and the text in it; \`path\`, when present, is the Val source path of the content it shows (a module file path, and the field in it): read it with get_source, and change it there. Outside code mode they can only point at content, so \`path\` is there.
- read_page reads the page in the preview: the text, the order, and -- with a selector, or picked: true -- one element's computed styles and how many lines it wraps to. screenshot_page is a picture of it. Use them to see what the person sees, or to check a change landed on the page; they answer that the preview is closed when it is.`;

/** A tool's answer: what the model is handed, and whether it failed. */
export type PageToolAnswer = {
  result: unknown;
  isError: boolean;
  /** Images for the model, by their keys as uploaded. */
  images?: string[];
};

const failed = (error: string): PageToolAnswer => ({
  result: { success: false, error },
  isError: true,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What `read_page` needs: the page in the preview, and what was picked. */
export type ReadPageDeps = {
  /** Reads the page in the preview; `null` while it is closed. */
  readPage:
    | ((options: {
        selector?: string;
        maxItems?: number;
      }) => Promise<PageSnapshot>)
    | null;
  /** What the person pointed the assistant at, if anything. */
  pointedAt: PickedElement | null;
  /** What to answer while there is no page. */
  noPage?: string;
};

/**
 * `read_page`: what the preview shows, read by the page itself through the
 * canvas bridge (`readPageSnapshot`), so the assistant can see it the way the
 * person does.
 */
export async function runReadPage(
  args: unknown,
  deps: ReadPageDeps,
): Promise<PageToolAnswer> {
  const input = isRecord(args) ? args : {};
  if (deps.readPage === null) return failed(deps.noPage ?? NO_PREVIEW);
  let selector =
    typeof input["selector"] === "string" ? input["selector"] : undefined;
  if (input["picked"] === true) {
    if (deps.pointedAt === null) {
      return failed(
        "Nothing is picked in the preview. Read the whole page, or ask the person to point you at the element with the Select in your header.",
      );
    }
    selector = deps.pointedAt.selector;
  }
  const maxItems =
    typeof input["max_items"] === "number" && input["max_items"] > 0
      ? Math.min(input["max_items"], 1000)
      : undefined;
  try {
    const snapshot = await deps.readPage({
      ...(selector !== undefined ? { selector } : {}),
      ...(maxItems !== undefined ? { maxItems } : {}),
    });
    return { result: { success: true, ...snapshot }, isError: false };
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
}

/** What `screenshot_page` needs: the page in the preview, and the chat. */
export type ScreenshotPageDeps = {
  /** Pictures the page in the preview; `null` while it is closed. */
  screenshotPage:
    | ((options: { fullPage?: boolean }) => Promise<PageScreenshot>)
    | null;
  /** Upload the picture as an image of the chat: its key. */
  uploadImage: (file: File) => Promise<{ key: string }>;
  /** What to answer while there is no page. */
  noPage?: string;
};

/**
 * `screenshot_page`: a picture of what the preview shows, drawn by the page
 * itself (`screenshotPage`), uploaded as an image of the chat and handed to
 * the model with the answer. `read_page` gives the words and boxes; this is
 * for what they cannot say -- a colour, an overlap, a button that wrapped.
 */
export async function runScreenshotPage(
  args: unknown,
  deps: ScreenshotPageDeps,
): Promise<PageToolAnswer> {
  const input = isRecord(args) ? args : {};
  if (deps.screenshotPage === null) return failed(deps.noPage ?? NO_PREVIEW);
  try {
    const shot = await deps.screenshotPage({
      fullPage: input["full_page"] === true,
    });
    // Decoded here rather than fetched: a page's policy may refuse `data:`.
    const base64 = shot.dataUrl.slice(shot.dataUrl.indexOf(",") + 1);
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const { key } = await deps.uploadImage(
      new File([bytes], "page.jpg", { type: "image/jpeg" }),
    );
    return {
      result: {
        success: true,
        width: shot.width,
        height: shot.height,
        full_page: shot.fullPage,
        ...(shot.clipped
          ? { note: "The page goes on below the picture." }
          : {}),
        image: "attached",
      },
      isError: false,
      images: [key],
    };
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
}

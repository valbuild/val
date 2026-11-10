import type { AITool } from "./useAIWebSocket";

/**
 * The page in the Studio's preview, as the assistant's tools see it: the
 * design tab's `read_page` and `screenshot_page` (`proposals/proposalCode.ts`
 * runs both), offered by the Studio's own assistant while the preview is
 * open beside it.
 *
 * Without `device`: in the Studio the preview's width is the person's
 * switch, and the assistant changing it under them would be a surprise. The
 * runners take it when there is a way to set it; none is passed here.
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

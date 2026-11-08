import { ChevronRight, PencilRuler } from "lucide-react";
import { createContext, useContext } from "react";

/**
 * Opens a sketchpad from a chat message. The Studio's shell provides it; in
 * a chat with no Sketchpad to open (the overlay), the card is still shown,
 * as something to read, and is not a button.
 */
export const OpenSketchpadContext = createContext<
  ((id: string) => void) | null
>(null);

/**
 * "Build" sent to the assistant, as the person's own message: the sketchpad
 * as a card, then what to do with it. The card is a `<sketchpad>` tag in the
 * message text, so the assistant reads the id and the title in the same
 * message, and the chat draws it as something to click (`SketchpadMessageCard`).
 *
 * What it asks for is a build, not an opinion: whoever presses Build wants
 * the pages changed to what the sketch shows.
 */
export function buildSketchpadMessage(sketchpad: {
  id: string;
  title: string | null;
  routes: string[];
}): string {
  const title = sketchpad.title ?? "Untitled sketch";
  const attr = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const routes = sketchpad.routes.join(" ");
  return [
    `<sketchpad id="${attr(sketchpad.id)}" title="${attr(title)}" routes="${attr(routes)}"></sketchpad>`,
    "Build this sketchpad. Read it with read_sketchpad, compare each page it names with that page's content now, and change the content so the pages match the sketch: its text, its order, its images. Use the images it names; an image from this chat goes into the site first. Change only what the sketch changed. If a block needs a kind of section the site does not have, it needs code: point at it with highlight_sketchpad_blocks and ask before going on.",
  ].join("\n");
}

/** The card a `<sketchpad>` tag in a chat message is drawn as. */
export function SketchpadMessageCard({
  id,
  title,
  routes,
}: {
  id: string;
  title: string;
  routes: string[];
}) {
  const open = useContext(OpenSketchpadContext);
  const body = (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg-brand-secondary text-fg-brand-secondary">
        <PencilRuler className="h-4 w-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="text-[11px] text-fg-secondary">Sketchpad</span>
        <span className="truncate text-sm font-medium">{title}</span>
        {routes.length > 0 && (
          <span className="truncate font-mono text-[11px] text-fg-tertiary">
            {routes.join("  ·  ")}
          </span>
        )}
      </span>
      {open && <ChevronRight className="h-4 w-4 shrink-0 text-fg-tertiary" />}
    </>
  );
  const className =
    "my-1 flex w-full max-w-sm items-center gap-2.5 rounded-lg border border-border-primary bg-bg-primary px-2.5 py-2 text-fg-primary";
  return open ? (
    <button
      type="button"
      onClick={() => open(id)}
      title="Open the sketchpad"
      className={`${className} cursor-pointer hover:bg-bg-secondary`}
    >
      {body}
    </button>
  ) : (
    <span className={className}>{body}</span>
  );
}

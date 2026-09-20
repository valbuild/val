import { createContext, ReactNode, useContext } from "react";

/**
 * How much room the editor is entitled to spend on saying where you are.
 *
 * `full` is the editor on its own: one column in the middle of the screen, and
 * the heading can lead the way a heading should — a 24px title with air around
 * it, because nothing else is competing for the top of the page.
 *
 * `compact` is the editor sharing the screen. Beside the canvas it is one of
 * three panes that all begin at the same line, and the other two start using
 * their space immediately: the preview's address bar is a control you type in,
 * the On page column's header is a count and a filter. A heading that spends
 * 124px to say `Blog 1` next to those does not read as a heading with presence,
 * it reads as a pane that has not loaded yet.
 *
 * It is a context rather than a prop because the thing that knows — the
 * workspace, which owns whether the canvas is open — and the thing that draws
 * the heading are the whole editor apart, and every component between them
 * would have to carry a prop that means nothing to it.
 */
export type EditorDensity = "full" | "compact";

const EditorDensityContext = createContext<EditorDensity>("full");

/**
 * `full` unless something says otherwise.
 *
 * The editor renders in places that have no workspace around it at all — a
 * story, a test, the overlay — and the answer there is the one the editor was
 * designed at.
 */
export function useEditorDensity(): EditorDensity {
  return useContext(EditorDensityContext);
}

export function EditorDensityProvider({
  density,
  children,
}: {
  density: EditorDensity;
  children: ReactNode;
}) {
  return (
    <EditorDensityContext.Provider value={density}>
      {children}
    </EditorDensityContext.Provider>
  );
}

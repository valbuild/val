import { createContext, ReactNode, useContext } from "react";

/**
 * Controls the shell puts beside the heading of whatever the editor shows.
 *
 * The phone's locale filter lives here. It filters what you are editing, so it
 * belongs with the thing being edited rather than in the chrome - where, on a
 * phone, it was one more button in a bottom bar that had already run out of
 * room. The editor is the app's (`renderEditor`), so the shell cannot put it
 * there itself; it hands it over, and the heading picks it up.
 *
 * `null` - the default, and every width above a phone - adds nothing.
 */
const HeadingToolsContext = createContext<ReactNode>(null);

export const HeadingToolsProvider = HeadingToolsContext.Provider;

export function useHeadingTools(): ReactNode {
  return useContext(HeadingToolsContext);
}

/**
 * THE WORDS OF THE GUIDED TOUR. Edit them here.
 *
 * This file is only text. Which stops a given project actually gets, what each
 * one points at and what it opens are in `tourSteps.ts`; nothing here decides
 * anything, so rewriting any of it is safe and needs no other change.
 *
 * Four things to keep in mind while editing:
 *
 * 1. **Never say "this button here".** A step degrades to a plain card in the
 *    middle of the screen wherever the control it points at is not drawn — the
 *    left rail below 1200px, and half the top bar on a phone. The words have to
 *    stand on their own.
 * 2. **Never define a word with itself.** The title here used to be "Pages are
 *    the pages of your site", which tells the one person who needs the step
 *    precisely nothing. If a title can be read as a tautology, the definition
 *    has not been written yet.
 * 3. **Titles are short, and their shape says what kind of thing this is.** A
 *    destination is a noun with a gloss — "Pages — every URL on your site" —
 *    which is the same shape as its tooltip in the rail, so the two reinforce
 *    each other. Something you DO is a verb: "Review before you send". Keep
 *    them under about 40 characters, or they wrap to two lines in a 296px card.
 * 4. **The body is a short paragraph**, two sentences and rarely three. Past
 *    about 45 words the card grows taller than the thing it is explaining, and
 *    the last clause is usually filler — "so this is the place to start when
 *    you know which page you want to change" says only "use this to use this".
 */

/** One step's words. */
export type TourText = { title: string; body: string };

/**
 * Every step the tour can have.
 *
 * `publish` and `save` are the same step wearing the word the button actually
 * wears: running against a local checkout the control says "Save", and a step
 * promising to send something live would be pointing at a button that does not.
 */
export type TourStepId =
  | "welcome"
  | "pages"
  | "media"
  | "data"
  | "ai"
  | "review"
  | "preview"
  | "publish"
  | "save"
  | "finish";

export const TOUR_COPY: Record<TourStepId, TourText> = {
  welcome: {
    title: "Welcome to the Studio",
    body: "Your content is on the left and opens in the middle. Everything you change is a draft that nobody outside can see until you publish it, which is what the buttons along the top are for. About a minute.",
  },
  pages: {
    title: "Pages — every URL on your site",
    body: "The rows mirror how your site is arranged, so a page is where you would expect to find it. Open one and you get that page's content, and nothing else.",
  },
  media: {
    title: "Media — images and files, in one place",
    body: "Upload a picture once and use it on as many pages as you like; replace it here and it changes on all of them. On a page you pick from this library rather than uploading again.",
  },
  data: {
    title: "Data — content that is not a page",
    body: "Menus, footers, opening hours, shared wording: things used across the site, or on no page at all. If you cannot find something under Pages, it is probably here.",
  },
  ai: {
    title: "Ask the assistant",
    body: "It can find content, draft it and change it for you, in plain words. What it writes is a draft like any other, so nothing it does goes live until you publish — it is safe to ask, and easy to undo.",
  },
  review: {
    title: "Review before you send",
    body: "Every change you have made, side by side with what is live now. It is also where you throw away an edit you have changed your mind about.",
  },
  preview: {
    title: "Preview on the real page",
    body: "Your drafts on the actual site, beside the editor or in a tab of its own. Still nobody's but yours.",
  },
  publish: {
    title: "Publish sends it live",
    body: "Everything in Review goes out at once. If something does not validate the button says so and stays off until it is fixed.",
  },
  save: {
    title: "Save writes it to your project",
    body: "There is no live site to publish to when you are running locally, so this writes your drafts to disk instead — where git and the rest of your tooling can see them.",
  },
  finish: {
    title: "That is everything",
    body: "Quick actions keeps the tour, so you can run it again or hand it to whoever edits next. Settings turns the offer off for the whole project.",
  },
};

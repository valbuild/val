/**
 * THE WORDS OF THE GUIDED TOUR. Edit them here.
 *
 * This file is only text. Which stops a given project actually gets, what each
 * one points at and what it opens are in `studioTour.ts`; nothing here decides
 * anything, so rewriting any of it is safe and needs no other change.
 *
 * Two things to keep in mind while editing:
 *
 * 1. **Never say "this button here".** A step degrades to a plain card in the
 *    middle of the screen wherever the control it points at is not drawn — the
 *    left rail below 1200px, and half the top bar on a phone. The words have to
 *    stand on their own.
 * 2. **The body is a short paragraph**, three or four lines in a 296px card.
 *    Past about 60 words the card grows taller than the thing it is explaining.
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
  | "review"
  | "preview"
  | "publish"
  | "save"
  | "finish";

export const TOUR_COPY: Record<TourStepId, TourText> = {
  welcome: {
    title: "Welcome to the Studio",
    body: "This is where your site's content is edited. Navigation is on the left, the thing you picked opens in the middle, and everything along the top is about getting a change out. About a minute.",
  },
  pages: {
    title: "Pages are the pages of your site",
    body: "One row per URL, nested the way your site is. Opening a row shows the content of that page and nothing else, so this is the place to start when you know which page you want to change.",
  },
  media: {
    title: "Media is the shared library of images and files",
    body: "Every picture and document that has been uploaded, in one place, so the same logo can be used on twenty pages and replaced once. You upload here; you pick an image from here in the field on the page itself.",
  },
  data: {
    title: "Data is the content that is not on one page",
    body: "Menus, footers, opening hours, shared wording — anything used across the site or in no page at all. Your developers decide what lives here, which is why it is a list of files rather than a list of URLs.",
  },
  review: {
    title: "Review what you changed",
    body: "Every edit is a draft until you send it. Review lists them side by side with what is live now, and it is also where an edit you regret is thrown away.",
  },
  preview: {
    title: "Preview it on the real page",
    body: "The site as it will look with your drafts in it — beside the editor as a canvas, or in a tab of its own. Nobody else sees any of this yet.",
  },
  publish: {
    title: "Publish sends it live",
    body: "One press ships everything in Review. It stays switched off while there are validation errors to fix, and it tells you which.",
  },
  save: {
    title: "Save writes it to your project",
    body: "Running locally there is no live site to publish to, so this writes your drafts into the project on disk — where the rest of your tooling, and git, can see them.",
  },
  finish: {
    title: "That is the whole thing",
    body: "Quick actions keeps the tour, so you can run it again — or hand it to whoever edits next. Settings turns the offer off for the whole project.",
  },
};

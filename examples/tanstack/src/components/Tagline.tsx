/**
 * The site's tagline, in a chunk of its own.
 *
 * Loaded lazily by the home route, and handed the tagline as a prop rather than
 * reading it with a hook, on purpose: it is the shape that hydrates AFTER the
 * component that read the content, and so the one that tells whether a draft
 * page's server HTML and its hydration agree no matter when each part of the
 * page hydrates. `e2e/tanstack/draftRender.spec.ts` reads it.
 */
export default function Tagline({ text }: { text: string }) {
  return <p>{text}</p>;
}

export default function Loading() {
  // This creates the Suspense boundary that catches useValStega/useValRoute
  // while the draft sources load. Without it, the suspended render would have
  // nowhere to land. Next.js renders this fallback (instead of a 404) for
  // routes that only exist in an uncommitted draft until the data arrives.
  return <div>Loading…</div>;
}

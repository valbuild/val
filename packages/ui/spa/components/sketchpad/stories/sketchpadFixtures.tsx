import { DesignSiteMock } from "../../design/stories/DesignSiteMock";

/**
 * What the Sketchpad stories share: the Nordic Retail home page as the
 * assistant sketched it, and the site's page as it is now.
 */
export const SKETCH = `# Clothes that outlast the season.
Made in Bergen from wool we can trace to the farm. Repaired free, for as long as you own it.
row
  [button: Shop autumn]
  [button: Book a fitting]
[hero: The grey wool coat, on the quay](image: /storybook-media/intro-poster_a627f.webp)
## Why it lasts
row
  col
    ### Traceable wool
    Every coat names the farm.
  col
    ### Repaired free
    For as long as you own it.
  col
    ### Made in Bergen
    Ten minutes from the shop.
## What customers say
row
  [testimonial: Sigrid, eleven winters in the same coat]
  [testimonial: Jonas, repaired twice and still going]
[newsletter: Hear about repairs and new wool]

icon button M3 8h18v8H3z M8 12h8
icon hero M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6
icon testimonial M4 17h4l2-4V7H4v6h3 M13 17h4l2-4V7h-6v6h3
icon newsletter M3 6h18v12H3z M3 6l9 7 9-7
`;

/** The sketch as the assistant writes it, a few blocks at a time. */
export function sketchingSteps(sketch: string): string[] {
  const [body, icons] = sketch.split("\n\n");
  const lines = body.split("\n");
  // Ends of whole blocks, so no step stops inside a row.
  const cuts = [2, 6, 7, 17, lines.length];
  return [
    ...cuts.map((cut) => lines.slice(0, cut).join("\n") + "\n"),
    `${body}\n\n${icons}`,
  ];
}

/** The site's page as it is now, in a frame with its address. */
export function PreviewMock() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border-primary px-3 py-2">
        <span className="text-xs font-medium text-fg-secondary">Preview</span>
        <span className="min-w-0 flex-1 truncate rounded-md bg-bg-secondary px-2 py-1 text-xs text-fg-secondary">
          nordic-retail.example/
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <DesignSiteMock testimonials="none" />
      </div>
    </div>
  );
}

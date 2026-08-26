/**
 * Where the focal point is, drawn on the image.
 *
 * A ring with a dot in it, in inline styles rather than utilities: it is drawn
 * over an arbitrary photo, so its contrast cannot come from the theme — white
 * with a dark shadow on both sides of the stroke is the one combination that
 * stays visible on a white sky and on a black jacket alike.
 *
 * One copy, positioned by the caller's container. There were two — the field's
 * own and the file gallery's preview — pixel for pixel identical, and a focal
 * point that renders in one place and not the other is exactly the kind of
 * difference nobody notices until an editor reports that the crop "moved".
 */
export function HotspotMarker({
  hotspot,
  size = "md",
}: {
  hotspot: { x: number; y: number };
  /**
   * `sm` for a thumbnail, where a 20px ring covers most of the picture.
   *
   * A prop rather than a third hand-written copy: the compare view had one, and
   * it drifted — a raw `zIndex: 10` and its own numbers, so it could stop
   * matching the field's without anyone noticing.
   */
  size?: "sm" | "md";
}) {
  const ring = size === "sm" ? 14 : 20;
  const dot = size === "sm" ? 3 : 4;
  const stroke = size === "sm" ? 1.5 : 2;
  return (
    <div
      /*
       * `z-hover`: above the image it is drawn on, and nothing else.
       *
       * It was a raw `zIndex: 10`, which on the shell's scale is above every
       * floating panel — so the focal point of an image in the editor column
       * showed through the Pages and Settings panels, a ring and a dot hovering
       * over unrelated UI. Nothing here needs to beat anything but the photo.
       * See the `zIndex` scale in `tailwind.config.js`.
       */
      className="pointer-events-none absolute z-hover"
      style={{
        top: `${hotspot.y * 100}%`,
        left: `${hotspot.x * 100}%`,
        transform: "translate(-50%, -50%)",
      }}
    >
      <div
        style={{
          width: `${ring}px`,
          height: `${ring}px`,
          borderRadius: "50%",
          border: `${stroke}px solid white`,
          boxShadow:
            "0 0 0 1px rgba(0,0,0,0.3), inset 0 0 0 1px rgba(0,0,0,0.3)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: `${dot}px`,
          height: `${dot}px`,
          borderRadius: "50%",
          backgroundColor: "white",
          boxShadow: "0 0 2px rgba(0,0,0,0.5)",
        }}
      />
    </div>
  );
}

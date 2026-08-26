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
}: {
  hotspot: { x: number; y: number };
}) {
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        top: `${hotspot.y * 100}%`,
        left: `${hotspot.x * 100}%`,
        transform: "translate(-50%, -50%)",
        zIndex: 10,
      }}
    >
      <div
        style={{
          width: "20px",
          height: "20px",
          borderRadius: "50%",
          border: "2px solid white",
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
          width: "4px",
          height: "4px",
          borderRadius: "50%",
          backgroundColor: "white",
          boxShadow: "0 0 2px rgba(0,0,0,0.5)",
        }}
      />
    </div>
  );
}

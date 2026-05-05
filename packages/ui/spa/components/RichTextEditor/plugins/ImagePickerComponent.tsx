import type { EditorImage } from "../types";

export function ImagePicker({
  images,
  currentSrc,
  onSelect,
}: {
  images: EditorImage[];
  currentSrc: string;
  onSelect: (url: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-medium text-fg-secondary">
        Select an image:
      </div>
      <div className="grid grid-cols-3 gap-2">
        {images.map((image) => (
          <button
            key={image.url}
            type="button"
            onClick={() => onSelect(image.url)}
            className={[
              "overflow-hidden rounded border-2 transition-all",
              currentSrc === image.url
                ? "border-border-brand-primary ring-2 ring-border-brand-primary"
                : "border-border-primary hover:border-border-brand-primary",
            ].join(" ")}
          >
            <img src={image.url} alt="" className="h-16 w-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}

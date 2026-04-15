import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../designSystem/select";
import { Folder } from "lucide-react";

export interface GalleryUploadTargetProps {
  modulePaths: string[];
  selectedPath?: string;
  onSelect?: (path: string) => void;
  /** Portal container for the select dropdown (shadow DOM support) */
  portalContainer?: HTMLElement | null;
}

/**
 * Derive a human-friendly display name from a module path.
 *
 * Examples:
 *   "/content/media.val.ts"          → "media"
 *   "/content/blog-images.val.ts"    → "blog images"
 *   "/content/pages/hero.val.ts"     → "pages / hero"
 *   "/schema/product_photos.val.ts"  → "product photos"
 */
export function prettyModuleName(modulePath: string): string {
  // Strip leading slash and the .val.ts (or .val.js) suffix
  const stripped = modulePath.replace(/^\//, "").replace(/\.val\.(ts|js)$/, "");

  // Split on "/" to get folder segments
  const segments = stripped.split("/");

  // Drop "content" or "schema" if it's the first segment and there's more
  if (
    segments.length > 1 &&
    (segments[0] === "content" || segments[0] === "schema")
  ) {
    segments.shift();
  }

  // Replace dashes/underscores with spaces in each segment and join with " / "
  return segments.map((s) => s.replace(/[-_]/g, " ")).join(" / ");
}

/**
 * When multiple gallery modules are referenced by a field,
 * this lets the user pick which gallery uploaded files should be added to.
 */
export function GalleryUploadTarget({
  modulePaths,
  selectedPath,
  onSelect,
  portalContainer,
}: GalleryUploadTargetProps) {
  const [value, setValue] = React.useState(
    selectedPath ?? modulePaths[0] ?? "",
  );

  return (
    <div className="flex items-center gap-2 text-xs text-fg-secondary">
      <span className="shrink-0">Add uploads to:</span>
      <Select
        value={value}
        disabled={modulePaths.length === 0}
        onValueChange={(v) => {
          setValue(v);
          onSelect?.(v);
        }}
      >
        <SelectTrigger className="h-7 text-xs">
          <SelectValue>
            <span className="flex items-center gap-1.5">
              <Folder className="h-3 w-3 shrink-0" />
              <span className="truncate">{prettyModuleName(value)}</span>
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent container={portalContainer}>
          {modulePaths.map((mp) => (
            <SelectItem key={mp} value={mp} className="text-xs">
              <span className="flex items-center gap-1.5">
                <Folder className="h-3 w-3 shrink-0 text-fg-secondary" />
                <span className="flex flex-col">
                  <span>{prettyModuleName(mp)}</span>
                  <span className="text-[10px] text-fg-secondary opacity-70">
                    {mp}
                  </span>
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

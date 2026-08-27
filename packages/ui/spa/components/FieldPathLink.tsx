import { ReactNode } from "react";
import { SourcePath } from "@valbuild/core";
import { Globe } from "lucide-react";
import { urlOf } from "@valbuild/shared/internal";
import { cn } from "./designSystem/cn";
import { getNavPathFromAll } from "./getNavPath";
import { useNavLink } from "./navLink";
import { useAllSources, useSchemas } from "./ValFieldProvider";

/**
 * The path of a field, as somewhere you can go.
 *
 * The errors view and the compare view both list fields by path, and both used
 * to render that path as `<button onClick={navigate}>` — with the same class
 * string and the same navigation body copied into each. Two copies of a
 * destination is how the two views end up disagreeing about where a path leads,
 * so there is one here.
 *
 * A link, not a button, for the same reason the scope trail is — see
 * {@link useNavLink}.
 */
const PATH_LINK_CLASS =
  "font-mono text-sm px-2 py-0.5 rounded bg-bg-secondary text-fg-primary truncate transition-colors min-w-0 block hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function FieldPathLink({
  sourcePath,
  previewSegment,
  className,
  children,
}: {
  sourcePath: SourcePath;
  /**
   * The route this row is about, when it is a page of a router.
   *
   * Adds the globe beside the path that opens the page itself in a new tab —
   * the one destination the studio's own router cannot take you to.
   */
  previewSegment?: string;
  className?: string;
  /** What the path is called. Each view names it its own way. */
  children: ReactNode;
}) {
  const schemas = useSchemas();
  const allSources = useAllSources();
  const schemasData = schemas.status === "success" ? schemas.data : undefined;
  /**
   * A leaf is opened at the nearest sensible ancestor, with the leaf scrolled to
   * — so the field arrives with its siblings around it rather than alone. See
   * `getNavPath`.
   */
  const navPath = getNavPathFromAll(sourcePath, allSources, schemasData);
  const target = navPath ?? sourcePath;
  const link = useNavLink(target, {
    scrollToPath: target !== sourcePath ? sourcePath : undefined,
  });
  const anchor = (
    <a {...link} title={sourcePath} className={cn(PATH_LINK_CLASS, className)}>
      {children}
    </a>
  );
  if (previewSegment === undefined) {
    return anchor;
  }
  const previewHref = urlOf("/api/val/enable", {
    redirect_to:
      (typeof window !== "undefined" ? window.location.origin : "") +
      previewSegment,
  });
  return (
    <span className="inline-flex items-center gap-1.5 truncate min-w-0 max-w-full">
      {anchor}
      <a
        href={previewHref}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 text-fg-tertiary hover:text-fg-primary transition-colors"
        title={`Preview ${previewSegment}`}
      >
        <Globe size={12} />
      </a>
    </span>
  );
}

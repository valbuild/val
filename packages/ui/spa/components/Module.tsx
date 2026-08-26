import { SourcePath } from "@valbuild/core";
import { useSchemaAtPath } from "./ValFieldProvider";
import { useValidationErrors } from "./ValErrorProvider";
import { useValPortal } from "./ValPortalProvider";
import { FieldSchemaError } from "./FieldSchemaError";
import { FieldLoading } from "./FieldLoading";
import { FieldNotFound } from "./FieldNotFound";
import { AnyField } from "./AnyField";
import { Fragment, useMemo } from "react";
import { FieldPatchAuthors } from "./FieldPatchAuthors";
import {
  ArrayAndRecordTools,
  splitIntoInitAndLastParts,
} from "./ArrayAndRecordTools";
import { isParentArray, isParentRecord, useParent } from "../hooks/useParent";
import { FieldValidationError } from "./FieldValidationError";
import { cn } from "./designSystem/cn";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
} from "./designSystem/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./designSystem/dropdown-menu";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "./designSystem/hover-card";
import { Globe } from "lucide-react";
import { Search } from "./Search";
import {
  usePendingPatches,
  useProfilesByAuthorId,
  PendingPatch,
} from "./ValProvider";
import { ModuleGallery } from "./fields/ModuleGallery";

export function Module({
  path,
  showModuleGalleryChild,
  hideHeader,
}: {
  path: SourcePath;
  showModuleGalleryChild: SourcePath | null;
  /**
   * Drop the breadcrumb and the title.
   *
   * For the canvas, where the page itself is on screen beside the fields: the
   * breadcrumb repeats what the address bar says, and its title repeats the
   * page's own heading. The record tools stay — they are the only way to add an
   * item, and they navigate nowhere.
   */
  hideHeader?: boolean;
}) {
  const schemaAtPath = useSchemaAtPath(path);
  const { path: maybeParentPath, schema: parentSchema } = useParent(path);
  const validationErrors = useValidationErrors(path);
  const pendingPatchesRes = usePendingPatches(path);
  const hasPendingPatches = pendingPatchesRes
    ? pendingPatchesRes.length > 0
    : false;
  const profilesByAuthorIds = useProfilesByAuthorId();
  const patchesByAuthorIds = useMemo((): Record<string, PendingPatch[]> => {
    const byAuthors: Record<string, PendingPatch[]> = {};
    for (const patch of pendingPatchesRes || []) {
      const author = patch.authorId ?? "unknown";
      if (!byAuthors[author]) {
        byAuthors[author] = [];
      }
      byAuthors[author].push(patch);
    }
    return byAuthors;
  }, [pendingPatchesRes]);
  const portalContainer = useValPortal();
  const parent = useParent(path);
  const isParentGallery = useMemo(() => {
    if (
      parent.path !== path &&
      parent.schema?.type === "record" &&
      parent.schema.mediaType
    ) {
      return true;
    }
    return false;
  }, [path, parent]);

  if (isParentGallery) {
    return (
      <Module key={path} path={parent.path} showModuleGalleryChild={path} />
    );
  }
  if (schemaAtPath.status === "error") {
    return (
      <FieldSchemaError path={path} error={schemaAtPath.error} type="module" />
    );
  }
  if (schemaAtPath.status === "loading") {
    return <FieldLoading path={path} type="module" />;
  }
  if ((path?.length || 0) === 0) {
    return <Home />;
  }
  if (schemaAtPath.status === "not-found") {
    return <FieldNotFound path={path} type="module" />;
  }

  const schema = schemaAtPath.data;
  const parts = splitIntoInitAndLastParts(path);
  const init = parts.slice(0, -1);
  const last = parts[parts.length - 1];
  const showNumber = isParentArray(path, maybeParentPath, parentSchema);
  const isKey = isParentRecord(path, maybeParentPath, parentSchema);
  const keyErrors = validationErrors.filter((error) => !!error.keyError);
  const nonKeyErrors = validationErrors.filter((error) => !error.keyError);

  // Check if the parent is a router record - only then should we display as URL path
  // Note: We check maybeParentPath !== path to ensure we're not at the root of the module
  const isParentRouter =
    maybeParentPath !== path &&
    parentSchema?.type === "record" &&
    Boolean(parentSchema?.router);

  // Check if the current schema is a router record
  const isCurrentRouter = schema.type === "record" && Boolean(schema.router);
  const isMediaGallery = schema.type === "record" && Boolean(schema.mediaType);
  const keyDescription =
    isKey && parentSchema?.type === "record"
      ? parentSchema.key?.description
      : undefined;

  return (
    <div className="flex flex-col gap-6 pt-4 pb-40">
      <div className="flex flex-col gap-2 text-left overflow-hidden">
        {parts.length > 1 && !hideHeader && (
          <ModuleBreadcrumb init={init} portalContainer={portalContainer} />
        )}
        <div
          className={cn({
            "border rounded-lg border-bg-warning-secondary p-4":
              keyErrors.length > 0,
          })}
        >
          <div className="flex gap-4 justify-between items-center min-h-6 text-xl">
            {!showNumber && !hideHeader && (
              <div className="min-w-0 flex-1">
                {isParentRouter ? (
                  <UrlPathBreadcrumb
                    path={last.text}
                    portalContainer={portalContainer}
                  />
                ) : isCurrentRouter ? (
                  <span className="inline-flex items-center gap-2">
                    <Globe size={20} className="text-fg-tertiary shrink-0" />
                    <span>Pages</span>
                  </span>
                ) : (
                  <span className="truncate block">{last.text}</span>
                )}
              </div>
            )}
            {showNumber && !hideHeader && (
              <span className="shrink-0">#{Number(last.text)}</span>
            )}
            {!isMediaGallery && (
              <div className="shrink-0 flex gap-2 items-center">
                {hasPendingPatches && (
                  <FieldPatchAuthors
                    patchesByAuthorIds={patchesByAuthorIds}
                    profilesByAuthorIds={profilesByAuthorIds}
                    sourcePath={path}
                  />
                )}
                <ArrayAndRecordTools path={path} variant={"module"} />
              </div>
            )}
          </div>
          {keyDescription && !hideHeader && (
            <div className="text-sm text-fg-tertiary">{keyDescription}</div>
          )}
          {keyErrors.length > 0 && (
            <FieldValidationError validationErrors={keyErrors} />
          )}
          {schema.description && (
            <div className="text-sm text-fg-tertiary">{schema.description}</div>
          )}
        </div>
      </div>
      <div>
        {isKey && nonKeyErrors.length > 0 && (
          <FieldValidationError validationErrors={validationErrors} />
        )}
        <div
          className={cn({
            "border rounded-lg border-bg-warning-secondary p-4 mt-4":
              nonKeyErrors.length > 0,
          })}
        >
          {showModuleGalleryChild ? (
            <ModuleGallery
              key={path}
              path={path}
              showChildPath={showModuleGalleryChild}
            />
          ) : (
            <AnyField key={path} path={path} schema={schema} />
          )}
        </div>
      </div>
    </div>
  );
}

function Home() {
  return (
    <div className="flex flex-col min-h-[calc(100vh-100px)] items-center grow">
      <div className="flex flex-col pt-20 gap-2 w-full max-w-md text-center">
        <div className="w-full">
          <Search />
        </div>
        <p className="text-sm text-fg-tertiary">
          Search or use the menu on the left to find and edit your content.
        </p>
      </div>
    </div>
  );
}

// Max visible items before showing ellipsis (first + ellipsis + last N)
const MAX_VISIBLE_ITEMS = 3;

/**
 * Where this module sits, as a trail — read, not clicked.
 *
 * The segments used to navigate, and the useful destinations were already in the
 * navigation panel: what the trail actually offered was the module ROOT, which
 * for a router is a record of every URL and for anything else is the module you
 * just came from. Clicking a page's own name took you to a record view of the
 * whole router, with the canvas still open beside it showing a page you were no
 * longer editing.
 *
 * So it says where you are and stops there. The collapsed middle is still a
 * menu, because a long path has to be readable, but its items do not navigate
 * either.
 */
function ModuleBreadcrumb({
  init,
  portalContainer,
}: {
  init: ReturnType<typeof splitIntoInitAndLastParts>;
  portalContainer: HTMLElement | null;
}) {
  const shouldCollapse = init.length > MAX_VISIBLE_ITEMS;
  const visibleStart = shouldCollapse ? init.slice(0, 1) : init;
  const collapsed = shouldCollapse ? init.slice(1, -2) : [];
  const visibleEnd = shouldCollapse ? init.slice(-2) : [];

  return (
    <Breadcrumb>
      <BreadcrumbList className="flex-nowrap text-fg-quaternary">
        {visibleStart.map((part, i) => (
          <Fragment key={`start-${i}`}>
            <BreadcrumbItem className="shrink-0">{part.text}</BreadcrumbItem>
            <BreadcrumbSeparator className="shrink-0" />
          </Fragment>
        ))}

        {shouldCollapse && collapsed.length > 0 && (
          <>
            <BreadcrumbItem className="shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-1">
                  <BreadcrumbEllipsis className="h-4 w-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" container={portalContainer}>
                  {collapsed.map((part, i) => (
                    <DropdownMenuItem key={i} disabled>
                      {part.text}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="shrink-0" />
          </>
        )}

        {visibleEnd.map((part, i) => (
          <Fragment key={`end-${i}`}>
            <BreadcrumbItem className="shrink-0">{part.text}</BreadcrumbItem>
            {i < visibleEnd.length - 1 && (
              <BreadcrumbSeparator className="shrink-0" />
            )}
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

// Max visible URL segments before showing ellipsis
const MAX_URL_SEGMENTS = 4;

function UrlPathBreadcrumb({
  path,
  portalContainer,
}: {
  path: string;
  portalContainer: HTMLElement | null;
}) {
  const { segments, isFullUrl, protocol, host } = useMemo(() => {
    // Parse the URL path
    const isFullUrl = path.startsWith("http://") || path.startsWith("https://");
    let pathPart = path;
    let protocol = "";
    let host = "";

    if (isFullUrl) {
      try {
        const url = new URL(path);
        protocol = url.protocol;
        host = url.host;
        pathPart = url.pathname;
      } catch {
        // If URL parsing fails, just use the original path
      }
    }

    // Split path into segments, filtering out empty strings
    const segments = pathPart.split("/").filter(Boolean);

    return { segments, isFullUrl, protocol, host };
  }, [path]);

  // Handle external URLs with no path segments (e.g., "https://www.google.com")
  if (segments.length === 0 && isFullUrl) {
    return (
      <HoverCard openDelay={200}>
        <HoverCardTrigger asChild>
          <div className="cursor-default">
            <Breadcrumb>
              <BreadcrumbList className="flex-nowrap text-xl font-normal">
                <BreadcrumbItem className="shrink-0">
                  <span className="text-fg-tertiary">{protocol}//</span>
                  <span>{host}</span>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </HoverCardTrigger>
        <HoverCardContent
          className="w-auto max-w-[400px] break-all"
          container={portalContainer}
          side="bottom"
          align="start"
        >
          <p className="font-mono text-sm">{path}</p>
        </HoverCardContent>
      </HoverCard>
    );
  }

  if (segments.length === 0) {
    return <span className="text-fg-secondary">/</span>;
  }

  const shouldCollapse = segments.length > MAX_URL_SEGMENTS;
  const visibleStart = shouldCollapse ? segments.slice(0, 1) : segments;
  const visibleEnd = shouldCollapse ? segments.slice(-2) : [];

  const breadcrumbContent = (
    <Breadcrumb>
      <BreadcrumbList className="flex-nowrap text-xl font-normal">
        {/* Show protocol and host for full URLs */}
        {isFullUrl && (
          <>
            <BreadcrumbItem className="shrink-0">
              <span className="text-fg-tertiary">{protocol}//</span>
              <span>{host}</span>
            </BreadcrumbItem>
          </>
        )}

        {/* Leading slash */}
        <BreadcrumbItem className="shrink-0">
          <span className="text-fg-tertiary">/</span>
        </BreadcrumbItem>

        {visibleStart.map((segment, i) => (
          <Fragment key={`start-${i}`}>
            <BreadcrumbItem
              className={cn("shrink-0", {
                "max-w-[120px]": i < visibleStart.length - 1,
              })}
            >
              <BreadcrumbPage className="truncate block">
                {segment}
              </BreadcrumbPage>
            </BreadcrumbItem>
            {(i < visibleStart.length - 1 ||
              shouldCollapse ||
              (!shouldCollapse && i < segments.length - 1)) && (
              <BreadcrumbSeparator className="shrink-0">
                <span className="text-fg-tertiary">/</span>
              </BreadcrumbSeparator>
            )}
          </Fragment>
        ))}

        {shouldCollapse && (
          <>
            <BreadcrumbItem>
              <BreadcrumbEllipsis className="h-4 w-4" />
            </BreadcrumbItem>
            <BreadcrumbSeparator className="shrink-0">
              <span className="text-fg-tertiary">/</span>
            </BreadcrumbSeparator>
          </>
        )}

        {visibleEnd.map((segment, i) => (
          <Fragment key={`end-${i}`}>
            <BreadcrumbItem className="shrink-0 max-w-[120px]">
              <BreadcrumbPage className="truncate block">
                {segment}
              </BreadcrumbPage>
            </BreadcrumbItem>
            {i < visibleEnd.length - 1 && (
              <BreadcrumbSeparator className="shrink-0">
                <span className="text-fg-tertiary">/</span>
              </BreadcrumbSeparator>
            )}
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );

  return (
    <HoverCard openDelay={200}>
      <HoverCardTrigger asChild>
        <div className="cursor-default">{breadcrumbContent}</div>
      </HoverCardTrigger>
      <HoverCardContent
        className="w-auto max-w-[400px] break-all"
        container={portalContainer}
        side="bottom"
        align="start"
      >
        <p className="font-mono text-sm">{path}</p>
      </HoverCardContent>
    </HoverCard>
  );
}

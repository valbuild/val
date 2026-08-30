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
import { ScopeTrail } from "./ModuleScope";

export function Module({
  path,
  showModuleGalleryChild,
}: {
  path: SourcePath;
  showModuleGalleryChild: SourcePath | null;
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

  /** The record tools, beside the title. */
  const tools = !isMediaGallery && (
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
  );

  /** What this module is called. */
  const titleNode = showNumber ? (
    <span className="shrink-0">#{Number(last.text)}</span>
  ) : isParentRouter ? (
    <UrlPathBreadcrumb path={last.text} portalContainer={portalContainer} />
  ) : isCurrentRouter ? (
    <span className="inline-flex items-center gap-2">
      <Globe size={20} className="text-fg-tertiary shrink-0" />
      <span>Pages</span>
    </span>
  ) : (
    <span className="truncate block">{last.text}</span>
  );

  return (
    <div className="flex flex-col gap-6 pt-4 pb-40">
      <div className="flex flex-col gap-2 text-left overflow-hidden">
        <div
          className={cn({
            "border rounded-lg border-bg-warning-secondary p-4":
              keyErrors.length > 0,
          })}
        >
          {/*
           * Title first, scope beneath.
           *
           * The name of the thing being edited leads, at a size that can lead;
           * the path is provenance and sits under it as links. The other way
           * round — a line of grey crumbs above a smaller title — spent the top
           * of the column on the part that does not change.
           */}
          <div className="flex gap-4 justify-between items-start min-h-6">
            {/*
             * The title and its description, in ONE column.
             *
             * The description was a sibling of this whole row, so its top
             * margin was measured from the row's bottom — and the row is as
             * tall as the tools on its right, not as tall as the title. That
             * put a fixed 12px between title and description no matter what
             * was asked for, the same 12px that then separated it from the
             * scope: three evenly spaced lines, with nothing saying which one
             * the description belonged to. Inside the column it sits against
             * the title, and the tools cannot push it around.
             */}
            <div className="min-w-0 flex-1">
              {/*
               * A heading, in the role sense: the editor column had none, so
               * nothing announced what was being edited and nothing could jump
               * to it. Not an `<h1>` element, because the title of a router
               * page is a breadcrumb — and a `<nav>` inside a heading element
               * is not valid HTML.
               */}
              <div
                role="heading"
                aria-level={1}
                className="text-2xl leading-tight"
              >
                {titleNode}
              </div>
              {keyDescription && (
                <div className="mt-1 text-sm text-fg-tertiary">
                  {keyDescription}
                </div>
              )}
            </div>
            {tools}
          </div>
          {init.length > 0 && (
            <ScopeTrail
              parts={init}
              portalContainer={portalContainer}
              className={keyDescription ? "mt-3" : "mt-1.5"}
            />
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
              // A readonly gallery module offered upload, delete and alt text
              // regardless, and every one of them wrote a patch.
              readonly={schema.readonly}
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
              <BreadcrumbList className="flex-nowrap font-normal">
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
      <BreadcrumbList className="flex-nowrap font-normal">
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

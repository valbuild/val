import { SourcePath } from "@valbuild/core";
import {
  useAllSources,
  useSchemaAtPath,
  useSchemas,
  useValidationErrors,
  useValPortal,
} from "./ValProvider";
import { FieldSchemaError } from "./FieldSchemaError";
import { FieldLoading } from "./FieldLoading";
import { FieldNotFound } from "./FieldNotFound";
import { AnyField } from "./AnyField";
import { Fragment, useCallback, useMemo } from "react";
import { useNavigation } from "./ValRouter";
import {
  ArrayAndRecordTools,
  splitIntoInitAndLastParts,
} from "./ArrayAndRecordTools";
import { isParentArray, isParentRecord, useParent } from "../hooks/useParent";
import { getNavPathFromAll } from "./getNavPath";
import { FieldValidationError } from "./FieldValidationError";
import { cn } from "./designSystem/cn";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
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

export function Module({ path }: { path: SourcePath }) {
  const schemaAtPath = useSchemaAtPath(path);
  const { path: maybeParentPath, schema: parentSchema } = useParent(path);
  const { navigate } = useNavigation();
  const sources = useAllSources();
  const schemasRes = useSchemas();
  const validationErrors = useValidationErrors(path);
  const onNavigate = useCallback(
    (path: SourcePath) => {
      if ("data" in schemasRes) {
        const schemas = schemasRes.data;
        const navPath = getNavPathFromAll(path, sources, schemas);
        if (navPath) {
          navigate(navPath);
        } else {
          navigate(path);
          console.error(`Error navigating to path: ${path} - no schemas found`);
        }
      } else {
        console.warn("Schemas not loaded yet");
        navigate(path);
      }
    },
    [schemasRes, sources, navigate],
  );
  if (schemaAtPath.status === "error") {
    return (
      <FieldSchemaError path={path} error={schemaAtPath.error} type="module" />
    );
  }
  if (schemaAtPath.status === "loading") {
    return <FieldLoading path={path} type="module" />;
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
  const portalContainer = useValPortal();

  // Check if the parent is a router record - only then should we display as URL path
  // Note: We check maybeParentPath !== path to ensure we're not at the root of the module
  const isParentRouter =
    maybeParentPath !== path &&
    parentSchema?.type === "record" &&
    Boolean(parentSchema?.router);

  // Check if the current schema is a router record
  const isCurrentRouter =
    schema.type === "record" && Boolean(schema.router);

  return (
    <div className="flex flex-col gap-6 pt-4 pb-40">
      <div className="flex flex-col gap-2 text-left overflow-hidden">
        {parts.length > 1 && (
          <ModuleBreadcrumb
            init={init}
            onNavigate={onNavigate}
            portalContainer={portalContainer}
          />
        )}
        <div
          className={cn({
            "border rounded-lg border-bg-error-secondary p-4":
              keyErrors.length > 0,
          })}
        >
          <div className="flex gap-4 justify-between items-center min-h-6 text-xl">
            {!showNumber && (
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
            {showNumber && <span className="shrink-0">#{Number(last.text)}</span>}
            <div className="shrink-0">
              <ArrayAndRecordTools path={path} variant={"module"} />
            </div>
          </div>
          {keyErrors.length > 0 && (
            <FieldValidationError validationErrors={keyErrors} />
          )}
        </div>
      </div>
      <div>
        {isKey && nonKeyErrors.length > 0 && (
          <FieldValidationError validationErrors={validationErrors} />
        )}
        <div
          className={cn({
            "border rounded-lg border-bg-error-secondary p-4 mt-4":
              nonKeyErrors.length > 0,
          })}
        >
          <AnyField key={path} path={path} schema={schema} />
        </div>
      </div>
    </div>
  );
}

// Max visible items before showing ellipsis (first + ellipsis + last N)
const MAX_VISIBLE_ITEMS = 3;

function ModuleBreadcrumb({
  init,
  onNavigate,
  portalContainer,
}: {
  init: ReturnType<typeof splitIntoInitAndLastParts>;
  onNavigate: (path: SourcePath) => void;
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
            <BreadcrumbItem className="shrink-0">
              <BreadcrumbLink asChild>
                <button onClick={() => onNavigate(part.sourcePath)}>
                  {part.text}
                </button>
              </BreadcrumbLink>
            </BreadcrumbItem>
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
                <DropdownMenuContent
                  align="start"
                  container={portalContainer}
                >
                  {collapsed.map((part, i) => (
                    <DropdownMenuItem
                      key={i}
                      onClick={() => onNavigate(part.sourcePath)}
                    >
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
            <BreadcrumbItem className="shrink-0">
              <BreadcrumbLink asChild>
                <button onClick={() => onNavigate(part.sourcePath)}>
                  {part.text}
                </button>
              </BreadcrumbLink>
            </BreadcrumbItem>
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
            <BreadcrumbItem className="shrink-0 max-w-[120px]">
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

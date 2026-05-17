import { useEffect, useMemo, useState } from "react";
import { ModuleFilePath } from "@valbuild/core";
import { RoutePattern } from "@valbuild/shared/internal";
import { cn } from "../designSystem/cn";
import { Button } from "../designSystem/button";

/**
 * A route a user can create new pages under.
 */
export type AvailableRoute = {
  moduleFilePath: ModuleFilePath;
  routePattern: RoutePattern[];
  /** Human-readable pattern, e.g. "/blogs/[blog]". */
  patternString: string;
  /** Existing URL paths that would collide if reused. */
  existingKeys: string[];
};

export type NewPageFormProps = {
  /** One or more routes the user can create pages under. */
  routes: AvailableRoute[];
  /** Called with the moduleFilePath and the fully built URL path. */
  onSubmit: (moduleFilePath: ModuleFilePath, urlPath: string) => void;
  /** Called when the user dismisses the form. */
  onCancel: () => void;
};

/**
 * Form for creating a new page in the sitemap.
 *
 * Supports:
 * - single dynamic segment routes (`/blogs/[blog]`)
 * - multi-segment routes (`/products/[category]/[product]`)
 * - catch-all routes (`/docs/[...slug]`)
 *
 * Visual treatment matches the redesigned sitemap: the static parts of the route
 * are rendered as non-editable chips, dynamic parts as inputs.
 */
export function NewPageForm({ routes, onSubmit, onCancel }: NewPageFormProps) {
  const [selectedRouteKey, setSelectedRouteKey] = useState<string>(() =>
    routeKey(routes[0]),
  );
  const selectedRoute = useMemo(
    () =>
      routes.find((r) => routeKey(r) === selectedRouteKey) ?? routes[0] ?? null,
    [routes, selectedRouteKey],
  );

  const [paramsByRoute, setParamsByRoute] = useState<
    Record<string, Record<string, string>>
  >({});
  const [errorsByRoute, setErrorsByRoute] = useState<
    Record<string, Record<string, string | undefined>>
  >({});

  const params = selectedRoute
    ? (paramsByRoute[routeKey(selectedRoute)] ?? {})
    : {};
  const errors = selectedRoute
    ? (errorsByRoute[routeKey(selectedRoute)] ?? {})
    : {};

  const fullPath = useMemo(() => {
    if (!selectedRoute) return "";
    return buildFullPath(selectedRoute.routePattern, params);
  }, [selectedRoute, params]);

  const isComplete = useMemo(() => {
    if (!selectedRoute) return false;
    return selectedRoute.routePattern.every((part) => {
      if (part.type === "string-param" || part.type === "array-param") {
        return !!params[part.paramName] && !errors[part.paramName];
      }
      return true;
    });
  }, [selectedRoute, params, errors]);

  const alreadyExists =
    !!selectedRoute && selectedRoute.existingKeys.includes(fullPath);
  const disabled = !isComplete || alreadyExists;

  // Focus the first dynamic input when the selected route changes.
  // We rely on autoFocus on render, so changing the key forces remount.
  const inputRenderKey = selectedRoute ? routeKey(selectedRoute) : "";

  if (!selectedRoute) {
    return (
      <div className="p-3 text-sm text-fg-secondary">
        No routes accept new pages.
      </div>
    );
  }

  return (
    <form
      className="p-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (disabled) return;
        onSubmit(selectedRoute.moduleFilePath, fullPath);
      }}
    >
      <div className="text-sm font-medium text-fg-primary">New page</div>

      {routes.length > 1 ? (
        <div className="space-y-1">
          <label className="text-xs text-fg-secondary">Route</label>
          <RouteSelect
            routes={routes}
            value={selectedRouteKey}
            onChange={(value) => setSelectedRouteKey(value)}
          />
        </div>
      ) : (
        <div className="space-y-1">
          <span className="text-xs text-fg-secondary">Route</span>
          <RoutePatternDisplay pattern={selectedRoute.routePattern} />
        </div>
      )}

      <div className="space-y-1">
        <span className="text-xs text-fg-secondary">URL</span>
        <RoutePatternInputs
          key={inputRenderKey}
          pattern={selectedRoute.routePattern}
          params={params}
          errors={errors}
          onChange={(paramName, value, error) => {
            const key = routeKey(selectedRoute);
            setParamsByRoute((prev) => ({
              ...prev,
              [key]: { ...(prev[key] ?? {}), [paramName]: value },
            }));
            setErrorsByRoute((prev) => ({
              ...prev,
              [key]: { ...(prev[key] ?? {}), [paramName]: error },
            }));
          }}
        />
        <RouteHint pattern={selectedRoute.routePattern} />
      </div>

      {alreadyExists && (
        <p className="text-xs text-fg-error">
          A page with this path already exists
        </p>
      )}

      <div className="flex gap-2 justify-end pt-1">
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={disabled} type="submit">
          Create
        </Button>
      </div>
    </form>
  );
}

function routeKey(route: AvailableRoute | undefined): string {
  if (!route) return "";
  return `${route.moduleFilePath}::${route.patternString}`;
}

/**
 * Build the full URL path from a route pattern and the user-filled params.
 * Mirrors the behavior of the old AddRouteForm.
 */
function buildFullPath(
  pattern: RoutePattern[],
  params: Record<string, string>,
): string {
  return (
    "/" +
    pattern
      .map((part) => {
        if (part.type === "string-param" || part.type === "array-param") {
          return params[part.paramName] || "";
        }
        return part.name;
      })
      .join("/")
  );
}

/**
 * Render the route pattern as a non-editable display, with dynamic
 * segments shown as purple pills.
 */
function RoutePatternDisplay({ pattern }: { pattern: RoutePattern[] }) {
  return (
    <div className="flex items-center flex-wrap gap-0 px-2 py-1.5 rounded-md bg-bg-secondary font-mono text-xs text-fg-primary">
      <span className="text-fg-secondary">/</span>
      {pattern.map((part, i) => (
        <span key={i} className="flex items-center">
          {part.type === "literal" ? (
            <span>{part.name}</span>
          ) : (
            <DynamicSegmentPill part={part} />
          )}
          {i < pattern.length - 1 && (
            <span className="text-fg-secondary">/</span>
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * Render the route pattern as a mix of static prefix chips and editable
 * inputs for dynamic segments.
 */
function RoutePatternInputs({
  pattern,
  params,
  errors,
  onChange,
}: {
  pattern: RoutePattern[];
  params: Record<string, string>;
  errors: Record<string, string | undefined>;
  onChange: (
    paramName: string,
    value: string,
    error: string | undefined,
  ) => void;
}) {
  // Group adjacent literals so they render as a single chip like "/blogs/".
  const groups = useMemo(() => groupPattern(pattern), [pattern]);
  const firstDynamicIndex = useMemo(
    () => groups.findIndex((g) => g.type !== "literal-run"),
    [groups],
  );

  return (
    <div className="flex items-stretch flex-wrap gap-1 font-mono text-xs">
      {groups.map((group, i) => {
        if (group.type === "literal-run") {
          return (
            <span
              key={i}
              className="inline-flex items-center px-2 rounded-md bg-bg-secondary text-fg-secondary"
            >
              /{group.parts.map((p) => p.name).join("/")}
              {i < groups.length - 1 ? "/" : ""}
            </span>
          );
        }

        const part = group.part;
        const value = params[part.paramName] || "";
        const error = errors[part.paramName];
        const isCatchAll = part.type === "array-param";

        return (
          <span key={i} className="inline-flex flex-col">
            <input
              autoFocus={i === firstDynamicIndex}
              className={cn(
                "h-7 px-2 rounded-md bg-bg-primary border border-border-primary text-fg-primary font-mono text-xs",
                "focus:outline-none focus:ring-1 focus:ring-border-focus",
                isCatchAll ? "min-w-[16ch]" : "min-w-[10ch]",
                {
                  "border-fg-error": !!error,
                },
              )}
              placeholder={part.paramName}
              value={value}
              onChange={(e) => {
                const next = e.target.value;
                const compare = isCatchAll ? next.replace(/\//g, "") : next;
                const invalid =
                  next.length > 0 && encodeURIComponent(compare) !== compare;
                onChange(
                  part.paramName,
                  next,
                  invalid ? "Invalid characters" : undefined,
                );
              }}
            />
            {error && (
              <span className="mt-0.5 text-[10px] text-fg-error">{error}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

type PatternGroup =
  | { type: "literal-run"; parts: { name: string }[] }
  | {
      type: "dynamic";
      part: Extract<
        RoutePattern,
        { type: "string-param" } | { type: "array-param" }
      >;
    };

function groupPattern(pattern: RoutePattern[]): PatternGroup[] {
  const groups: PatternGroup[] = [];
  let currentRun: { name: string }[] | null = null;
  for (const part of pattern) {
    if (part.type === "literal") {
      if (!currentRun) {
        currentRun = [];
        groups.push({ type: "literal-run", parts: currentRun });
      }
      currentRun.push({ name: part.name });
    } else {
      currentRun = null;
      groups.push({ type: "dynamic", part });
    }
  }
  return groups;
}

function DynamicSegmentPill({
  part,
}: {
  part: Extract<
    RoutePattern,
    { type: "string-param" } | { type: "array-param" }
  >;
}) {
  const label =
    part.type === "array-param" ? `...${part.paramName}` : part.paramName;
  return (
    <span className="inline-flex items-center px-1.5 py-0 rounded text-[11px] bg-bg-brand-secondary text-fg-brand-secondary">
      [{label}]
    </span>
  );
}

function RouteHint({ pattern }: { pattern: RoutePattern[] }) {
  const hasCatchAll = pattern.some((p) => p.type === "array-param");
  const dynamicCount = pattern.filter(
    (p) => p.type === "string-param" || p.type === "array-param",
  ).length;

  if (hasCatchAll) {
    return (
      <p className="text-[11px] text-fg-secondary">
        Catch-all segments can contain <code>/</code> for nested paths.
      </p>
    );
  }
  if (dynamicCount > 1) {
    return (
      <p className="text-[11px] text-fg-secondary">
        Fill in each segment. Slashes will be added automatically.
      </p>
    );
  }
  return (
    <p className="text-[11px] text-fg-secondary">
      Use lowercase letters, numbers, and hyphens.
    </p>
  );
}

/**
 * Native select used for picking the route when multiple are available.
 * Kept simple — the Radix Select needs a portal container and complicates the
 * popover. A native select is a reasonable default for the count of routes
 * a project will typically have.
 */
function RouteSelect({
  routes,
  value,
  onChange,
}: {
  routes: AvailableRoute[];
  value: string;
  onChange: (value: string) => void;
}) {
  // Force the selected route to be valid if `routes` changes.
  useEffect(() => {
    if (!routes.find((r) => routeKey(r) === value) && routes[0]) {
      onChange(routeKey(routes[0]));
    }
  }, [routes, value, onChange]);

  return (
    <select
      className={cn(
        "w-full h-8 px-2 rounded-md bg-bg-primary border border-border-primary",
        "font-mono text-xs text-fg-primary",
        "focus:outline-none focus:ring-1 focus:ring-border-focus",
      )}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {routes.map((route) => (
        <option key={routeKey(route)} value={routeKey(route)}>
          {route.patternString}
        </option>
      ))}
    </select>
  );
}

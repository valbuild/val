import { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "./designSystem/button";
import { RoutePattern } from "@valbuild/shared/internal";
import { cn } from "./designSystem/cn";
import { extractRoutePatternParams } from "../utils/extractRoutePatternParams";
import { routePatternToString } from "./NavMenu/SitemapItem";

export function RouteForm({
  routePattern,
  existingKeys,
  onSubmit,
  submitText,
  defaultParams,
  onCancel,
  defaultValue,
  keyDescription,
}: {
  routePattern: RoutePattern[];
  existingKeys: string[];
  onSubmit: (key: string) => void;
  submitText: string;
  defaultParams?: {
    [paramName: string]: string;
  };
  onCancel: () => void;
  defaultValue?: string;
  keyDescription?: string;
}) {
  const [params, setParams] = useState<{
    [paramName: string]: string | string[];
  }>({});
  useEffect(() => {
    if (defaultParams) {
      setParams(defaultParams);
    }
  }, [defaultParams]);
  const [errors, setErrors] = useState<{
    [paramName: string]: string | undefined;
  }>({});
  /**
   * Seed the form from `defaultValue` when the ROUTE changes - not when its
   * array is rebuilt.
   *
   * `routePattern` is an array prop whose identity belongs to the sitemap:
   * `collectNewPageRoutes` copies `item.routePattern` by reference, so every
   * sitemap rebuild hands this component an equal-but-new array. With the array
   * itself as the dependency, that re-ran this effect and overwrote what the
   * editor had typed - and because the submit is disabled while `fullPath ===
   * defaultValue`, the reset put the form back to the URL it already had and
   * the button went disabled and stayed that way.
   *
   * Keyed on the pattern's STRING form, which is what "the same route" actually
   * means - `routePatternToString` is careful to keep `[x]` and `[[x]]` apart,
   * so two genuinely different routes still re-seed. The pattern is read
   * through a ref so the effect uses the current one without depending on its
   * identity. `RouteForm.test.tsx` pins both halves.
   */
  const patternRef = useRef(routePattern);
  patternRef.current = routePattern;
  const patternKey = routePatternToString(routePattern);
  useEffect(() => {
    if (defaultValue) {
      const result = extractRoutePatternParams(
        patternRef.current,
        defaultValue,
      );
      if (result.status === "success") {
        setParams(result.params);
      }
    }
  }, [defaultValue, patternKey]);
  const fullPath = useMemo(() => {
    return (
      "/" +
      routePattern
        .map((part) => {
          if (part.type === "string-param" || part.type === "array-param") {
            const paramValue = params[part.paramName];
            if (Array.isArray(paramValue)) {
              return paramValue.join("/");
            }
            return paramValue;
          }
          return part.name;
        })
        .join("/")
    );
  }, [routePattern, params]);
  const isComplete = useMemo(() => {
    return routePattern.every((part) => {
      if (part.type === "string-param" || part.type === "array-param") {
        return !!params[part.paramName] && !errors[part.paramName];
      }
      return true;
    });
  }, [routePattern, params, errors]);

  const isUnchanged = fullPath === defaultValue;
  const alreadyExists =
    existingKeys.includes(fullPath) && fullPath !== defaultValue;
  const disabled = !isComplete || isUnchanged || alreadyExists;

  return (
    <form
      // NB: no padding here - the container (a popover) provides it, so that the
      // route inputs line up with the key description shown above the form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(fullPath);
      }}
    >
      {keyDescription && (
        <div className="text-sm text-fg-tertiary">{keyDescription}</div>
      )}
      <div className="flex items-center">
        {routePattern.map((part, i) => (
          <span key={i} className="truncate">
            {part.type === "string-param" || part.type === "array-param" ? (
              <span className="flex items-center">
                <span>/</span>
                <span className="flex flex-col">
                  <input
                    className={cn("p-1 bg-transparent border-0 max-w-[10ch]", {
                      "border-border-secondary border-1":
                        errors[part.paramName],
                    })}
                    placeholder={part.paramName}
                    value={getParamValue(params, part.paramName)}
                    onChange={(e) => {
                      setParams({
                        ...params,
                        [part.paramName]: e.target.value,
                      });
                      const compareValue =
                        part.type === "string-param"
                          ? e.target.value
                          : e.target.value.replace(/\//g, "");
                      if (encodeURIComponent(compareValue) !== compareValue) {
                        setErrors({
                          ...errors,
                          [part.paramName]: "Invalid characters",
                        });
                      } else {
                        setErrors({
                          ...errors,
                          [part.paramName]: undefined,
                        });
                      }
                    }}
                  />
                  {errors[part.paramName] && (
                    <span className="text-xs text-fg-error-secondary">
                      {errors[part.paramName]}
                    </span>
                  )}
                </span>
              </span>
            ) : (
              <span className="text-fg-secondary">/{part.name}</span>
            )}
          </span>
        ))}
      </div>
      {alreadyExists && (
        <p className="text-sm text-fg-error-secondary">
          A route with this path already exists
        </p>
      )}
      <div className="flex gap-4">
        <Button disabled={disabled}>{submitText}</Button>
        <Button variant={"ghost"} type="reset" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function getParamValue(
  params: {
    [paramName: string]: string | string[];
  },
  paramName: string,
) {
  const value = params[paramName];
  if (Array.isArray(value)) {
    return value.join("/");
  }
  return value || "";
}

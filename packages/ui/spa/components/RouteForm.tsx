import { useState, useEffect, useMemo } from "react";
import { Button } from "./designSystem/button";
import { RoutePattern } from "@valbuild/shared/internal";
import { cn } from "./designSystem/cn";
import { extractRoutePatternParams } from "../utils/extractRoutePatternParams";

export function RouteForm({
  routePattern,
  existingKeys,
  onSubmit,
  submitText,
  defaultParams,
  onCancel,
  defaultValue,
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
  useEffect(() => {
    if (defaultValue) {
      const result = extractRoutePatternParams(routePattern, defaultValue);
      if (result.status === "success") {
        setParams(result.params);
      }
    }
  }, [defaultValue, routePattern]);
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

  const disabled = !isComplete || fullPath in existingKeys;
  return (
    <form
      className="p-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(fullPath);
      }}
    >
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

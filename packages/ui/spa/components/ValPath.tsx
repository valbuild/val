import { Internal, ModuleFilePath, ModulePath } from "@valbuild/core";
import { useEffect, useRef, useState } from "react";
import { useAllSources, useSchemas } from "./ValProvider";
import { prettifyFilename } from "../utils/prettifyFilename";
import { Tooltip, TooltipContent } from "./designSystem/tooltip";
import { TooltipTrigger } from "@radix-ui/react-tooltip";
import { ScrollArea } from "./designSystem/scroll-area";
import { getNavPathFromAll } from "./getNavPath";
import { useNavigation } from "./ValRouter";
import { resolvePatchPath } from "../resolvePatchPath";
import { cn } from "./designSystem/cn";
import classNames from "classnames";

export function ValPath({
  moduleFilePath,
  patchPath,
  className,
  toolTip = true,
  link = true,
}: {
  moduleFilePath: ModuleFilePath;
  link?: boolean;
  toolTip?: boolean;
  patchPath: string[];
  className?: string;
}) {
  const containerRef = useRef<HTMLAnchorElement>(null);
  const textWidthCacheRef = useRef<Map<string, number>>(new Map());
  const [segments, setSegments] = useState<Segment[]>([]);
  const [fullPath, setFullPath] = useState<string>();
  const allSources = useAllSources();
  const schemasRes = useSchemas();
  const { navigate } = useNavigation();
  useEffect(() => {
    const moduleFilePathSegments = moduleFilePath
      ? Internal.splitModuleFilePath(moduleFilePath)
      : [];
    const modulePathSegments = patchPath;

    const update = () => {
      if (!containerRef.current) return;

      const container = containerRef.current;
      const style = getComputedStyle(container);
      const font = `${style.fontSize} ${style.fontFamily}`;

      const containerWidth = container.offsetWidth;
      const inputSegments = moduleFilePathSegments
        .map(prettierModuleFilePathText)
        .concat(modulePathSegments)
        .map((seg) => `/${seg}`);
      setFullPath(inputSegments.join(""));

      const getWidth = (text: string) => {
        const textWidthCacheKey = `${text}:${font}`;
        const segWidth =
          textWidthCacheRef.current.get(textWidthCacheKey) ??
          measureTextWidth(text, font);
        textWidthCacheRef.current.set(textWidthCacheKey, segWidth);
        return segWidth;
      };

      const ellipsisText = "/…";
      const ellipsisWidth = getWidth(ellipsisText);

      const segments: Segment[] = [];
      let totalWidth = 0;
      for (let i = inputSegments.length - 1; i >= 0; i--) {
        const segWidth = getWidth(inputSegments[i]);
        const isLeftMost = i === 0; // aka. the "first" segment if you read from left to right (normal)
        // const isRightMost = i === inputSegments.length - 1; // aka. the "last" segment if you read from left to right (normal)
        const needsEllipsis = !isLeftMost;

        if (
          totalWidth + segWidth + (needsEllipsis ? ellipsisWidth : 0) <=
          containerWidth
        ) {
          const type =
            i > moduleFilePathSegments.length
              ? "module-path"
              : "module-file-path";
          segments.unshift({
            text: inputSegments[i],
            type,
            moduleFilePath,
            modulePathSegments: modulePathSegments.slice(0, i),
          });
          totalWidth += segWidth;
        } else {
          segments.unshift({
            type: "ellipsis",
            text: ellipsisText,
          });
          break;
        }
      }
      setSegments(segments);
    };

    const observer = new ResizeObserver(update);
    if (containerRef.current) {
      observer.observe(containerRef.current);
      update();
    }

    return () => {
      if (containerRef.current) observer.unobserve(containerRef.current);
    };
  }, [moduleFilePath, patchPath]);
  return (
    <Tooltip open={toolTip === false ? false : undefined}>
      <TooltipTrigger asChild>
        <a
          ref={containerRef}
          className={classNames(
            `inline-block whitespace-nowrap overflow-hidden w-full align-baseline`,
            {
              "cursor-pointer hover:underline": link,
            },
            className,
          )}
          onClick={(e) => {
            if (!link) return;
            e.preventDefault();
            const schemas = "data" in schemasRes ? schemasRes.data : {};
            const resolvedSourcePath = resolvePatchPath(
              patchPath,
              schemas[moduleFilePath],
              allSources[moduleFilePath],
            );
            if (resolvedSourcePath.success) {
              const sourcePath = Internal.joinModuleFilePathAndModulePath(
                moduleFilePath,
                resolvedSourcePath.modulePath,
              );
              const navPath = getNavPathFromAll(
                sourcePath,
                allSources,
                schemas,
              );
              if (navPath) {
                navigate(navPath, {
                  scrollToId: sourcePath,
                });
              } else {
                console.error(
                  `Failed to resolve nav path for ${moduleFilePath} and ${patchPath.join(
                    ".",
                  )}: ${navPath}`,
                );
                navigate(moduleFilePath);
              }
            } else {
              console.error(
                `Failed to resolve source path for ${moduleFilePath} and ${patchPath.join(
                  ".",
                )}: ${resolvedSourcePath.error}`,
              );
              navigate(moduleFilePath);
            }
          }}
        >
          {segments.map((segment, index) => {
            return <span key={index}>{segment.text}</span>;
          })}
        </a>
      </TooltipTrigger>
      <TooltipContent side="top">
        <ScrollArea
          orientation="horizontal"
          className="max-w-[calc(100vw-3rem)] whitespace-nowrap"
        >
          {fullPath}
        </ScrollArea>
      </TooltipContent>
    </Tooltip>
  );
}

function prettierModuleFilePathText(input: string) {
  const str = prettifyFilename(input);
  const capitalizedStr = str.slice(0, 1).toUpperCase() + str.slice(1);
  return capitalizedStr;
}

type Segment =
  | {
      text: string;
      moduleFilePath: ModuleFilePath;
      modulePathSegments: string[];
      type: "module-file-path" | "module-path";
    }
  | {
      type: "ellipsis";
      text: string;
    };

function measureTextWidth(text: string, font: string) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  ctx.font = font;
  return ctx.measureText(text).width;
}

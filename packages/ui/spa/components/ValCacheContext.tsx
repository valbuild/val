import React, { useContext, useEffect, useState } from "react";
import { ValCache } from "@valbuild/shared/internal";
import {
  Internal,
  Json,
  ModuleFilePath,
  ModulePath,
  SerializedSchema,
} from "@valbuild/core";
import { result } from "@valbuild/core/fp";

export type Theme = "dark" | "light";
export type EditMode = "off" | "hover" | "window" | "full";
export type WindowSize = {
  width: number;
  height: number;
  innerHeight: number;
};

export const ValCacheContext = React.createContext<{
  cache: ValCache;
}>({
  get cache(): never {
    throw Error(
      "ValCacheContext not found. Ensure components are wrapped by ValCacheContext!",
    );
  },
});

export type ValFromPath =
  | { status: "idle" }
  | {
      status: "loading";
    }
  | {
      status: "success";

      source: Json;
      schema: SerializedSchema;
    }
  | {
      status: "error";
      error: {
        message: string;
      };
    };
export function useValFromPath(
  moduleFilePath: ModuleFilePath,
  modulePath: ModulePath,
): ValFromPath {
  const [current, setCurrent] = useState<ValFromPath>({ status: "idle" });

  const { cache } = useContext(ValCacheContext);
  useEffect(() => {
    setCurrent({ status: "loading" });
    cache.getModule(moduleFilePath).then(async (moduleRes) => {
      if (result.isOk(moduleRes)) {
        const module = moduleRes.value;
        const valAtPath = Internal.resolvePath(
          modulePath,
          module.source,
          module.schema,
        );
        setCurrent({
          status: "success",
          source: valAtPath.source,
          schema: valAtPath.schema,
        });
      } else {
        setCurrent({
          status: "error",
          error: {
            message: moduleRes.error.message,
          },
        });
      }
    });
  }, [moduleFilePath, modulePath]);

  return current;
}

export function useStore() {
  const { cache } = useContext(ValCacheContext);
  return cache;
}

export function ValCacheProvider({
  cache: store,
  children,
}: {
  cache: ValCache;
  children: React.ReactNode;
}) {
  return (
    <ValCacheContext.Provider value={{ cache: store }}>
      {children}
    </ValCacheContext.Provider>
  );
}

import React, { useContext, useEffect, useState } from "react";
import { ValStore } from "@valbuild/shared/internal";
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

export const ValStoreContext = React.createContext<{
  store: ValStore;
}>({
  get store(): never {
    throw Error(
      "ValStoreContext not found. Ensure components are wrapped by ValStoreContext!"
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
  modulePath: ModulePath
): ValFromPath {
  const [current, setCurrent] = useState<ValFromPath>({ status: "idle" });

  const { store } = useContext(ValStoreContext);
  useEffect(() => {
    setCurrent({ status: "loading" });
    store.getModule(moduleFilePath).then(async (moduleRes) => {
      if (result.isOk(moduleRes)) {
        const module = moduleRes.value;
        const valAtPath = Internal.resolvePath(
          modulePath,
          module.source,
          module.schema
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
  const { store } = useContext(ValStoreContext);
  return store;
}

export function ValStoreProvider({
  store,
  children,
}: {
  store: ValStore;
  children: React.ReactNode;
}) {
  return (
    <ValStoreContext.Provider value={{ store }}>
      {children}
    </ValStoreContext.Provider>
  );
}

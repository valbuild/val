import {
  GenericSelector,
  Internal,
  ModuleFilePath,
  SelectorOf,
  SelectorSource,
} from "@valbuild/core";
import {
  StegaOfSource,
  getModuleIds,
  stegaEncode,
} from "@valbuild/react/stega";
import React from "react";
import { ValConfig } from "@valbuild/core";
import { useValEvents } from "../ValContext";
import { fetchRemoteSource, nullifyRemoteSource } from "@valbuild/server";

export type UseValType<T extends SelectorSource> =
  SelectorOf<T> extends GenericSelector<infer S> ? StegaOfSource<S> : never;
function useValStega<T extends SelectorSource>(selector: T): UseValType<T> {
  const [enabled, setEnabled] = React.useState(false);
  const valEvents = useValEvents();
  React.useEffect(() => {
    setEnabled(
      document.cookie.includes(`${Internal.VAL_ENABLE_COOKIE_NAME}=true`)
    );
  }, [valEvents]);
  if (valEvents) {
    const moduleIds = getModuleIds(selector) as ModuleFilePath[];
    const moduleMap = React.useSyncExternalStore(
      valEvents.subscribe(moduleIds),
      valEvents.getSnapshot(moduleIds),
      valEvents.getServerSnapshot(moduleIds)
    );
    return stegaEncode(selector, {
      disabled: !enabled,
      getModule: (moduleId) => {
        if (moduleMap && enabled) {
          return moduleMap[moduleId as ModuleFilePath];
        }
      },
    });
  }
  return stegaEncode(selector, { disabled: !enabled });
}

function useValStegaSuspense<T extends SelectorSource>(
  selector: T
): UseValType<T> {
  const maybeRemoteStegaSource = useValStega(selector);
  const [resource, setResource] = React.useState<{
    status: string;
    result: UseValType<T> | null;
    promise: Promise<void> | null;
  }>({
    status: "pending",
    result: maybeRemoteStegaSource,
    promise: null,
  });
  React.useEffect(() => {
    const promise = fetchRemoteSource(maybeRemoteStegaSource)
      .then((res) => {
        setResource({
          status: "success",
          result: res,
          promise: null,
        });
      })
      .catch((err) => {
        console.error("Val: could not fetch remote source", err);
        setResource({
          status: "error",
          result: null,
          promise: null,
        });
      });

    setResource((prevResource) => ({
      ...prevResource,
      promise,
    }));
  }, [maybeRemoteStegaSource]);

  if (resource.status === "pending") {
    throw resource.promise;
  } else if (resource.status === "error") {
    throw new Error("Content could not be fetched.");
  } else {
    if (resource.result === null) {
      return nullifyRemoteSource(maybeRemoteStegaSource);
    }
    return resource.result;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function initValClient(config: ValConfig): {
  useValStega: typeof useValStega;
} {
  return {
    useValStega: useValStegaSuspense,
  };
}

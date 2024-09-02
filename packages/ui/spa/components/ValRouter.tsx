import { ModuleFilePath, SourcePath } from "@valbuild/core";
import React, { useCallback, useContext, useEffect, useState } from "react";

const ValRouterContext = React.createContext<{
  hardLink: boolean;
  useNavigate: () => (path: SourcePath | ModuleFilePath) => void;
  sourcePath: SourcePath;
}>({
  hardLink: false,
  useNavigate: () => () => {},
  sourcePath: "" as SourcePath,
});

const VAL_CONTENT_VIEW_ROUTE = "/val/~"; // TODO: make route configurable

/**
 * ValRouter was written to emulate the react-router (while also including some useful amenities) which does not work with Next Router
 **/
export function ValRouter({
  children,
  overlay,
}: {
  children: React.ReactNode;
  overlay?: boolean;
}) {
  const [sourcePath, setSourcePath] = useState("" as SourcePath);
  useEffect(() => {
    const listener = () => {
      const valPathIndex = location.pathname.indexOf(VAL_CONTENT_VIEW_ROUTE);
      if (valPathIndex > -1) {
        const modulePath = new URLSearchParams(location.search).get("p");
        const moduleFilePath = location.pathname.slice(
          valPathIndex + VAL_CONTENT_VIEW_ROUTE.length,
        );
        const path = moduleFilePath + (modulePath ? `?p=${modulePath}` : "");
        setSourcePath(path as SourcePath);
      }
    };
    listener();
    window.addEventListener("popstate", listener);
    return () => {
      window.removeEventListener("popstate", listener);
    };
  }, []);
  const useNavigate = useCallback<
    () => (path: SourcePath | ModuleFilePath) => void
  >(
    () => (path) => {
      const navigateTo = `${VAL_CONTENT_VIEW_ROUTE}${path}`;
      setSourcePath(path as SourcePath);
      if (!overlay) {
        window.history.pushState(null, "", navigateTo);
      } else {
        window.location.href = navigateTo;
      }
    },
    [overlay],
  );
  return (
    <ValRouterContext.Provider
      value={{
        hardLink: !!overlay,
        sourcePath,
        useNavigate,
      }}
    >
      {children}
    </ValRouterContext.Provider>
  );
}

export function useNavigate(): (path: SourcePath | ModuleFilePath) => void {
  return useContext(ValRouterContext).useNavigate();
}

export function useParams(): {
  sourcePath?: SourcePath;
} {
  const ctx = useContext(ValRouterContext);
  return {
    sourcePath: ctx.sourcePath,
  };
}

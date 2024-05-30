import {
  Internal,
  ModuleFilePath,
  ModulePath,
  SourcePath,
} from "@valbuild/core";
import React, { useContext, useEffect } from "react";

/** Val routing: written to emulate the react-router (while also including some useful amenities: ) which does not work with Next Router */

const ValRouterContext = React.createContext<{
  hardLink: boolean;
  useNavigate: () => (path: SourcePath | ModuleFilePath) => void;
  basePath: string;
  sourcePath: SourcePath;
  moduleFilePath: ModuleFilePath;
  modulePath: ModulePath;
}>({
  hardLink: false,
  useNavigate: () => () => {},
  basePath: "",
  sourcePath: "" as SourcePath,
  moduleFilePath: "" as ModuleFilePath,
  modulePath: "" as ModulePath,
});

function sourcePathFromBasePath(basePath: string): SourcePath {
  return (basePath ? `/${decodeURIComponent(basePath)}` : "") as SourcePath;
}

export function ValRouter({
  children,
  overlay,
}: {
  children: React.ReactNode;
  overlay?: boolean;
}) {
  const [basePath, setBasePath] = React.useState("");
  const [currentSourcePath, setCurrentSourcePath] = React.useState(
    sourcePathFromBasePath(basePath)
  );
  useEffect(() => {
    if (!overlay) {
      const basePath = getBasePath();
      if (basePath) {
        setCurrentSourcePath(sourcePathFromBasePath(basePath));
      }

      window.onpopstate = () => {
        const pathSegments = window.location.pathname.split("/");
        const valIndex = getBaseIndex(pathSegments);
        const basePath = (
          valIndex === -1 ? pathSegments : pathSegments.slice(valIndex + 1)
        ).join("/");
        setCurrentSourcePath(sourcePathFromBasePath(basePath));
        setBasePath(basePath);
      };
    }
  }, []);

  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(currentSourcePath);

  return (
    <ValRouterContext.Provider
      value={{
        hardLink: !!overlay,
        useNavigate: () => (path: SourcePath | ModuleFilePath) => {
          if (overlay) {
            // TODO: avoid hard coding here
            window.location.href = `/val${path}`;
          } else {
            setCurrentSourcePath(path as SourcePath);
            navigate(path);
            setBasePath(path);
          }
        },
        basePath,
        moduleFilePath: moduleFilePath,
        modulePath,
        sourcePath: currentSourcePath,
      }}
    >
      {children}
    </ValRouterContext.Provider>
  );
}

function navigate(path: string) {
  const pathSegments = window.location.pathname.split("/");
  const valIndex = getBaseIndex(pathSegments);
  const navigateTo = `${pathSegments
    .slice(0, valIndex + 1)
    .concat(...path.split("/").slice(1))
    .join("/")}`;

  window.history.pushState(null, "", navigateTo);
}

export function useNavigate(): (path: SourcePath | ModuleFilePath) => void {
  return useContext(ValRouterContext).useNavigate();
}

export function useParams(): {
  basePath: string;
  sourcePath?: SourcePath;
  moduleFilePath: ModuleFilePath;
  modulePath: ModulePath;
} {
  const ctx = useContext(ValRouterContext);
  return {
    basePath: ctx.basePath,
    sourcePath: ctx.sourcePath,
    moduleFilePath: ctx.moduleFilePath,
    modulePath: ctx.modulePath,
  };
}

function getBasePath() {
  const pathSegments = window.location.pathname.split("/");
  const valIndex = getBaseIndex(pathSegments);
  const basePath = (
    valIndex === -1 ? pathSegments : pathSegments.slice(valIndex + 1)
  ).join("/");
  return basePath;
}

function getBaseIndex(pathSegments: string[]) {
  // TODO: This is a hack to get the value of the last segment in the path
  const isStatic = pathSegments.indexOf("static");
  const baseIndex = isStatic === -1 ? pathSegments.indexOf("val") : isStatic;
  if (baseIndex === -1) {
    console.error("Router error", pathSegments, baseIndex);
  }
  return baseIndex;
}

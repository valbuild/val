import { ModuleFilePath, SourcePath } from "@valbuild/core";
import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

type ValRouterContextValue = {
  hardLink: boolean;
  ready: boolean;
  navigate: (
    path: SourcePath | ModuleFilePath,
    params?: {
      scrollToId?: string;
      replace?: true;
    },
  ) => void;
  currentSourcePath: SourcePath;
};
const ValRouterContext = React.createContext<ValRouterContextValue>(
  new Proxy(
    {},
    {
      get: () => {
        throw Error("ValRouter context not provided");
      },
    },
  ) as ValRouterContextValue,
);

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
  const [ready, setReady] = useState(false);
  const [currentSourcePath, setSourcePath] = useState("" as SourcePath);
  const historyState = useRef<number[]>([]);
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
        // reset scroll position
        const prevScrollPos = historyState.current.pop();
        setTimeout(() => {
          const scrollContainer = document
            .getElementById("val-shadow-root")
            ?.shadowRoot?.getElementById("val-content-area");
          if (prevScrollPos) {
            scrollContainer?.scrollTo(0, prevScrollPos);
          }
        }, 50);
      }
      setReady(true);
    };
    listener();
    window.addEventListener("popstate", listener);
    return () => {
      window.removeEventListener("popstate", listener);
    };
  }, []);
  const navigate = useCallback(
    (
      path: SourcePath | ModuleFilePath,
      params?: { scrollToId?: string; replace?: true },
    ) => {
      const navigateTo = `${VAL_CONTENT_VIEW_ROUTE}${path}`;
      setSourcePath(path as SourcePath);
      if (!overlay) {
        const shadowRoot =
          document.getElementById("val-shadow-root")?.shadowRoot;
        const scrollContainer = shadowRoot?.getElementById("val-content-area");
        const prevScrollPos = scrollContainer?.scrollTop;
        if (params?.scrollToId && shadowRoot) {
          setTimeout(() => {
            if (params?.scrollToId && shadowRoot) {
              shadowRoot.getElementById(params.scrollToId)?.scrollIntoView({
                behavior: "smooth",
              });
            }
          }, 100);
        } else {
          scrollContainer?.scrollTo(0, 0);
        }
        if (prevScrollPos !== undefined) {
          // NOTE: we cannot use history.state since it is overridden by Next.js
          historyState.current.push(prevScrollPos);
        }
        if (params?.replace) {
          window.history.replaceState(null, "", navigateTo);
        } else {
          window.history.pushState(null, "", navigateTo);
        }
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
        currentSourcePath,
        navigate,
        ready,
      }}
    >
      {children}
    </ValRouterContext.Provider>
  );
}

export function useNavigation() {
  const { navigate, currentSourcePath, ready } = useContext(ValRouterContext);
  return {
    navigate,
    currentSourcePath,
    ready,
  };
}

export function useParams(): {
  sourcePath?: SourcePath;
} {
  const ctx = useContext(ValRouterContext);
  return {
    sourcePath: ctx.currentSourcePath,
  };
}

import { ModuleFilePath, SourcePath } from "@valbuild/core";
import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

const VAL_COMPARE_ROUTE = "/val/compare";

type ValRouterContextValue = {
  hardLink: boolean;
  ready: boolean;
  navigate: (
    path: SourcePath | ModuleFilePath | typeof VAL_COMPARE_ROUTE,
    params?: {
      scrollToPath?: SourcePath | ModuleFilePath;
      replace?: true;
    },
  ) => void;
  currentSourcePath: SourcePath;
  isCompareView: boolean;
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

const STUDIO_PATH_ATTR = "data-val-studio-path";

function findStudioPathTarget(
  root: ShadowRoot,
  path: string,
): HTMLElement | null {
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>(`[${STUDIO_PATH_ATTR}]`),
  );
  for (const el of candidates) {
    if (el.getAttribute(STUDIO_PATH_ATTR) === path) return el;
  }
  return null;
}

function doScroll(shadowRoot: ShadowRoot, element: HTMLElement) {
  shadowRoot.getElementById("val-content-area")?.scrollTo({
    top: Math.max(0, element.offsetTop - 16),
    behavior: "smooth",
  });
  element.classList.remove("val-scroll-highlight");
  void element.offsetWidth;
  element.classList.add("val-scroll-highlight");
  element.addEventListener(
    "animationend",
    () => element.classList.remove("val-scroll-highlight"),
    { once: true },
  );
}

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
  const [isCompareView, setIsCompareView] = useState(false);
  const historyState = useRef<number[]>([]);
  useEffect(() => {
    const listener = () => {
      if (
        location.pathname === VAL_COMPARE_ROUTE ||
        location.pathname === VAL_COMPARE_ROUTE + "/"
      ) {
        setIsCompareView(true);
        setSourcePath("" as SourcePath);
        setReady(true);
        return;
      }
      setIsCompareView(false);
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
        if (prevScrollPos) {
          setTimeout(() => {
            const scrollContainer = document
              .getElementById("val-shadow-root")
              ?.shadowRoot?.getElementById("val-content-area");
            if (prevScrollPos) {
              scrollContainer?.scrollTo(0, prevScrollPos);
            }
          }, 50);
        } else if (location.hash) {
          const scrollToPath = decodeURIComponent(location.hash.slice(1));
          // remove hash:
          window.history.replaceState(
            null,
            "",
            location.pathname + location.search,
          );
          let retriesLeft = 100;
          const execScroll = () => {
            if (scrollToPath) {
              const shadowRoot =
                document.getElementById("val-shadow-root")?.shadowRoot;
              const element = shadowRoot
                ? findStudioPathTarget(shadowRoot, scrollToPath)
                : null;
              if (element && shadowRoot) {
                doScroll(shadowRoot, element);
              } else if (retriesLeft > 0) {
                retriesLeft--;
                setTimeout(execScroll, 100);
              }
            }
          };
          execScroll();
        }
      } else if (
        location.pathname === "/val" ||
        location.pathname === "/val/" ||
        location.pathname === VAL_CONTENT_VIEW_ROUTE
      ) {
        // Handle the home route - reset to empty path
        setSourcePath("" as SourcePath);
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
      path: SourcePath | ModuleFilePath | typeof VAL_COMPARE_ROUTE,
      params?: {
        scrollToPath?: SourcePath | ModuleFilePath;
        replace?: true;
      },
    ) => {
      const isCompare = path === VAL_COMPARE_ROUTE;
      const navigateTo = isCompare
        ? VAL_COMPARE_ROUTE
        : `${VAL_CONTENT_VIEW_ROUTE}${path}`;
      setIsCompareView(isCompare);
      setSourcePath(isCompare ? ("" as SourcePath) : (path as SourcePath));
      if (!overlay) {
        const shadowRoot =
          document.getElementById("val-shadow-root")?.shadowRoot;
        const scrollContainer = shadowRoot?.getElementById("val-content-area");
        const prevScrollPos = scrollContainer?.scrollTop;
        const scrollToPath = params?.scrollToPath;
        if (scrollToPath && shadowRoot) {
          let retriesLeft = 10;
          const execScroll = () => {
            const element = findStudioPathTarget(shadowRoot, scrollToPath);
            if (element) {
              doScroll(shadowRoot, element);
            } else if (retriesLeft > 0) {
              retriesLeft--;
              setTimeout(execScroll, 100);
            }
          };
          setTimeout(execScroll, 100);
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
        window.location.href =
          navigateTo +
          (params?.scrollToPath
            ? `#${encodeURIComponent(params.scrollToPath)}`
            : "");
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
        isCompareView,
      }}
    >
      {children}
    </ValRouterContext.Provider>
  );
}

export function useNavigation() {
  const { navigate, currentSourcePath, ready, isCompareView } =
    useContext(ValRouterContext);
  return {
    navigate,
    currentSourcePath,
    ready,
    isCompareView,
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

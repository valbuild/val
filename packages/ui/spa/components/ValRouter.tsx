import { ModuleFilePath, SourcePath } from "@valbuild/core";
import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { VAL_AI_SESSION_STORAGE_KEY } from "@valbuild/shared/internal";

const VAL_COMPARE_ROUTE = "/val/compare";
export const VAL_ERRORS_ROUTE = "/val/errors";

type ValRouterContextValue = {
  hardLink: boolean;
  ready: boolean;
  navigate: (
    path:
      | SourcePath
      | ModuleFilePath
      | typeof VAL_COMPARE_ROUTE
      | typeof VAL_ERRORS_ROUTE,
    params?: {
      scrollToPath?: SourcePath | ModuleFilePath;
      replace?: true;
      errorFields?: SourcePath[];
    },
  ) => void;
  currentSourcePath: SourcePath;
  isCompareView: boolean;
  isErrorsView: boolean;
  errorFields: SourcePath[];
  /** Current value of the `?session=` query param, or null if absent. */
  sessionParam: string | null;
  /** Update the `?session=` query param. No-op when running in overlay mode. */
  setSessionParam: (id: string | null, opts?: { replace?: boolean }) => void;
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
  const [isErrorsView, setIsErrorsView] = useState(false);
  const [errorFields, setErrorFields] = useState<SourcePath[]>([]);
  const [sessionParam, setSessionParamState] = useState<string | null>(null);
  const historyState = useRef<number[]>([]);
  useEffect(() => {
    const listener = () => {
      setSessionParamState(new URLSearchParams(location.search).get("session"));
      if (
        location.pathname === VAL_COMPARE_ROUTE ||
        location.pathname === VAL_COMPARE_ROUTE + "/"
      ) {
        setIsCompareView(true);
        setIsErrorsView(false);
        setErrorFields([]);
        setSourcePath("" as SourcePath);
        setReady(true);
        return;
      }
      if (
        location.pathname === VAL_ERRORS_ROUTE ||
        location.pathname === VAL_ERRORS_ROUTE + "/"
      ) {
        setIsErrorsView(true);
        setIsCompareView(false);
        setErrorFields(
          new URLSearchParams(location.search).getAll(
            "error-field",
          ) as SourcePath[],
        );
        setSourcePath("" as SourcePath);
        setReady(true);
        return;
      }
      setIsCompareView(false);
      setIsErrorsView(false);
      setErrorFields([]);
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
      path:
        | SourcePath
        | ModuleFilePath
        | typeof VAL_COMPARE_ROUTE
        | typeof VAL_ERRORS_ROUTE,
      params?: {
        scrollToPath?: SourcePath | ModuleFilePath;
        replace?: true;
        errorFields?: SourcePath[];
      },
    ) => {
      const isCompare = path === VAL_COMPARE_ROUTE;
      const isErrors = path === VAL_ERRORS_ROUTE;
      const errorFieldsQuery =
        isErrors && params?.errorFields && params.errorFields.length > 0
          ? "?" +
            params.errorFields
              .map((p) => `error-field=${encodeURIComponent(p)}`)
              .join("&")
          : "";
      const navigateTo = isCompare
        ? VAL_COMPARE_ROUTE
        : isErrors
          ? VAL_ERRORS_ROUTE + errorFieldsQuery
          : `${VAL_CONTENT_VIEW_ROUTE}${path}`;
      // Preserve `?session=` across in-studio navigations. Without this every
      // sidebar/compare/errors click would strip the AI chat session id from
      // the URL. URL only — useAI does not re-read this after mount, so chat
      // state is intentionally not affected by navigations.
      //
      // In overlay mode the host page URL has no `?session=`, so fall back to
      // sessionStorage so AI navigate_to (and overlay→studio nav generally)
      // brings the active chat along to the studio.
      let sid: string | null = sessionParam;
      if (overlay && sid == null) {
        try {
          sid = sessionStorage.getItem(VAL_AI_SESSION_STORAGE_KEY);
        } catch {
          sid = null;
        }
      }
      const finalTo = sid
        ? `${navigateTo}${navigateTo.includes("?") ? "&" : "?"}session=${encodeURIComponent(sid)}`
        : navigateTo;
      setIsCompareView(isCompare);
      setIsErrorsView(isErrors);
      setErrorFields(isErrors ? (params?.errorFields ?? []) : []);
      setSourcePath(
        isCompare || isErrors ? ("" as SourcePath) : (path as SourcePath),
      );
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
          window.history.replaceState(null, "", finalTo);
        } else {
          window.history.pushState(null, "", finalTo);
        }
      } else {
        window.location.href =
          finalTo +
          (params?.scrollToPath
            ? `#${encodeURIComponent(params.scrollToPath)}`
            : "");
      }
    },
    [overlay, sessionParam],
  );
  const setSessionParam = useCallback(
    (id: string | null, opts?: { replace?: boolean }) => {
      // Overlay runs on the host page — never mutate that URL.
      if (overlay) return;
      const url = new URL(window.location.href);
      if (id == null) url.searchParams.delete("session");
      else url.searchParams.set("session", id);
      const target = url.pathname + url.search + url.hash;
      if (opts?.replace) {
        window.history.replaceState(null, "", target);
      } else {
        window.history.pushState(null, "", target);
      }
      setSessionParamState(id);
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
        isErrorsView,
        errorFields,
        sessionParam,
        setSessionParam,
      }}
    >
      {children}
    </ValRouterContext.Provider>
  );
}

export function useNavigation() {
  const {
    navigate,
    currentSourcePath,
    ready,
    isCompareView,
    isErrorsView,
    errorFields,
  } = useContext(ValRouterContext);
  return {
    navigate,
    currentSourcePath,
    ready,
    isCompareView,
    isErrorsView,
    errorFields,
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

export function useSessionParam() {
  const { sessionParam, setSessionParam } = useContext(ValRouterContext);
  return { sessionParam, setSessionParam };
}

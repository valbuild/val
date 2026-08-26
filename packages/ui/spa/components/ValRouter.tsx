import { ModuleFilePath, SourcePath } from "@valbuild/core";
import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { VAL_AI_SESSION_STORAGE_KEY } from "@valbuild/shared/internal";

export const VAL_COMPARE_ROUTE = "/val/compare";
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
  /**
   * The exact field the route is focused on, when it is deeper than the module
   * `currentSourcePath` names.
   *
   * The two differ because opening one field should not hide the rest of the
   * page it is on. A pick on the canvas, a search hit or a validation error all
   * name a leaf, and the editor is opened at the nearest sensible ancestor of it
   * — see `getNavPath` — so the field arrives in context, with its siblings
   * around it. This is the leaf itself, kept so the thing that was asked for can
   * still be pointed at: scrolled to, outlined on the page, marked in the fields
   * list. Null when the route is already the module the editor shows.
   */
  focusedSourcePath: SourcePath | null;
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

/**
 * Query params a route builds for itself, and which must not be carried.
 *
 * `p` is the module path — it is part of the source path the route is built
 * from, not a separate piece of state — so carrying it appends the previous
 * page's path to the next one's and the URL ends up naming two.
 *
 * `error-field` belongs to the errors view: carrying it would mean the fields
 * from one visit followed you to the next, which is how a view ends up showing
 * errors nobody asked about.
 *
 * `field` is the leaf the route is focused on, which belongs to the navigation
 * that set it: carrying it would leave the previous field outlined on a page it
 * is not on.
 */
const ROUTE_OWNED_PARAMS = ["p", "error-field", "field"];

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

/**
 * Scroll to a path once something renders it.
 *
 * Retried rather than done once, because the target does not exist yet: the
 * navigation has only just set the route, and the field being scrolled to is
 * somewhere in a module tree that is still mounting — and on a cold load, still
 * being fetched.
 */
export function scrollToStudioPath(path: string, retries = 100) {
  const execScroll = () => {
    const shadowRoot = document.getElementById("val-shadow-root")?.shadowRoot;
    const element = shadowRoot ? findStudioPathTarget(shadowRoot, path) : null;
    if (element && shadowRoot) {
      doScroll(shadowRoot, element);
    } else if (retries > 0) {
      retries--;
      setTimeout(execScroll, 100);
    }
  };
  execScroll();
}

/** Clearance to leave above a field when nothing says otherwise. */
const DEFAULT_SCROLL_CLEARANCE = 16;

/**
 * Bring a field to the top of the editor, below whatever floats over it.
 *
 * Measured from bounding rects rather than from `offsetTop`. `offsetTop` is
 * relative to the nearest *positioned* ancestor, and the field tree has plenty
 * of those, so what it reports is usually a fraction of the distance to the
 * scroll container — the scroll then stopped short and left the field below the
 * fold. Rects plus the container's current `scrollTop` is the real distance
 * whatever the tree looks like.
 *
 * The clearance comes from the container, because only the layout knows what is
 * covering it: the shell's top bar floats over the editor column, and in the
 * canvas the view switch takes a row of its own instead. A field scrolled to
 * `top` in the first case lands underneath the bar.
 */
function doScroll(shadowRoot: ShadowRoot, element: HTMLElement) {
  const container = shadowRoot.getElementById("val-content-area");
  if (container) {
    const declared = Number(container.dataset.scrollClearance);
    const clearance = Number.isFinite(declared)
      ? declared
      : DEFAULT_SCROLL_CLEARANCE;
    const distance =
      element.getBoundingClientRect().top -
      container.getBoundingClientRect().top;
    container.scrollTo({
      top: Math.max(0, container.scrollTop + distance - clearance),
      behavior: "smooth",
    });
  }
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
  const [focusedSourcePath, setFocusedSourcePath] = useState<SourcePath | null>(
    null,
  );
  const [isCompareView, setIsCompareView] = useState(false);
  const [isErrorsView, setIsErrorsView] = useState(false);
  const [errorFields, setErrorFields] = useState<SourcePath[]>([]);
  // Read `?session=` synchronously on the first render: consumers capture this
  // value once on mount (see initialSessionIdRef in ToolsMenu), so populating
  // it from the popstate listener alone would miss a session id that was
  // already in the URL on initial page load.
  const [sessionParam, setSessionParamState] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("session"),
  );
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
        const focused = new URLSearchParams(location.search).get("field");
        setFocusedSourcePath(focused ? (focused as SourcePath) : null);
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
          if (scrollToPath) {
            scrollToStudioPath(scrollToPath);
          }
        } else if (focused) {
          // A link that named a field means it: land on the field rather than at
          // the top of whatever module contains it.
          scrollToStudioPath(focused);
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
      /**
       * Carry the studio's own state across the navigation.
       *
       * A navigation replaces the whole URL, so anything the studio had put in
       * the query — the AI session, which canvas is open and where it is
       * looking — is gone unless it is carried. Everything is carried except
       * the params a route owns, which are rebuilt above for the route being
       * navigated to.
       *
       * Generic rather than a list of names, because the alternative is that
       * every new piece of studio state has to remember to add itself here,
       * and the failure when it forgets is silent: a link that looks right and
       * restores half of what it should.
       */
      const carried = new URLSearchParams(
        typeof window === "undefined" ? "" : window.location.search,
      );
      for (const owned of ROUTE_OWNED_PARAMS) {
        carried.delete(owned);
      }
      // In overlay mode the host page URL has no `?session=`, so fall back to
      // sessionStorage: AI navigate_to (and overlay→studio nav generally)
      // should bring the active chat along to the studio.
      let sid: string | null = sessionParam;
      if (overlay && sid == null) {
        try {
          sid = sessionStorage.getItem(VAL_AI_SESSION_STORAGE_KEY);
        } catch {
          sid = null;
        }
      }
      if (sid) {
        carried.set("session", sid);
      } else {
        carried.delete("session");
      }
      /**
       * The leaf this navigation was asked for, when it is not the module being
       * opened.
       *
       * Durable rather than a one-shot scroll: the field is what someone
       * actually picked, and it has to survive being copied as a link, being
       * come back to with the back button, and the canvas switching views. It
       * lives in the query for the same reason `p` does — the alternative was a
       * hash, which the studio strips on read and which never reaches a reload.
       */
      const focused =
        !isCompare && !isErrors && params?.scrollToPath !== path
          ? (params?.scrollToPath ?? null)
          : null;
      if (focused) {
        carried.set("field", focused);
      }
      const carriedQuery = carried.toString();
      const finalTo = carriedQuery
        ? `${navigateTo}${navigateTo.includes("?") ? "&" : "?"}${carriedQuery}`
        : navigateTo;
      setIsCompareView(isCompare);
      setIsErrorsView(isErrors);
      setErrorFields(isErrors ? (params?.errorFields ?? []) : []);
      setSourcePath(
        isCompare || isErrors ? ("" as SourcePath) : (path as SourcePath),
      );
      setFocusedSourcePath(focused as SourcePath | null);
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
        focusedSourcePath,
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
    focusedSourcePath,
    ready,
    isCompareView,
    isErrorsView,
    errorFields,
  } = useContext(ValRouterContext);
  return {
    navigate,
    currentSourcePath,
    focusedSourcePath,
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

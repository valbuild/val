import { ModuleFilePath, SourcePath } from "@valbuild/core";
import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

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
      scrollToId?: string;
      replace?: true;
      errorFields?: SourcePath[];
    },
  ) => void;
  currentSourcePath: SourcePath;
  isCompareView: boolean;
  isErrorsView: boolean;
  errorFields: SourcePath[];
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

function findFieldWrapper(element: HTMLElement): HTMLElement {
  let el: HTMLElement | null = element.parentElement;
  while (el) {
    if (el.id === "val-content-area") break;
    if (
      el.classList.contains("border") &&
      el.classList.contains("rounded-lg")
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return element;
}

function doScroll(shadowRoot: ShadowRoot, element: HTMLElement) {
  const target = findFieldWrapper(element);
  shadowRoot.getElementById("val-content-area")?.scrollTo({
    top: Math.max(0, target.offsetTop - 16),
    behavior: "smooth",
  });
  target.classList.remove("val-scroll-highlight");
  void target.offsetWidth;
  target.classList.add("val-scroll-highlight");
  target.addEventListener(
    "animationend",
    () => target.classList.remove("val-scroll-highlight"),
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
  const historyState = useRef<number[]>([]);
  useEffect(() => {
    const listener = () => {
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
          const scrollToId = decodeURIComponent(location.hash.slice(1));
          // remove hash:
          window.history.replaceState(
            null,
            "",
            location.pathname + location.search,
          );
          let retriesLeft = 100;
          const execScroll = () => {
            if (scrollToId) {
              const shadowRoot =
                document.getElementById("val-shadow-root")?.shadowRoot;
              const element = shadowRoot?.getElementById(scrollToId);
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
        scrollToId?: string;
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
        const scrollId = params?.scrollToId;
        if (scrollId && shadowRoot) {
          let retriesLeft = 10;
          const execScroll = () => {
            const element = shadowRoot.getElementById(scrollId);
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
          navigateTo + (params?.scrollToId ? `#${params.scrollToId}` : "");
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
        isErrorsView,
        errorFields,
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

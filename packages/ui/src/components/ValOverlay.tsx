import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useState,
} from "react";
import { Session } from "../dto/Session";
import { ValMenu } from "./ValMenu";
import { EditMode, Theme, ValOverlayContext } from "./ValOverlayContext";
import { Remote } from "../utils/Remote";
import { FetchApi } from "../utils/FetchApi";
import { ValWindow } from "./ValWindow";

export type ValOverlayProps = {
  api: FetchApi;
  defaultTheme?: "dark" | "light";
};

export function ValOverlay({ api, defaultTheme }: ValOverlayProps) {
  const [theme, setTheme] = useTheme(defaultTheme);
  const session = useSession(api);

  const [editMode, setEditMode] = useInitEditMode();
  const [hoverTarget, setHoverTarget] = useHoverTarget(editMode);
  const [windowTarget, setWindowTarget] = useState<WindowTarget | null>(null);

  const [highlight, setHighlight] = useState(false);

  return (
    <ValOverlayContext.Provider
      value={{
        api,
        theme,
        session,
        editMode,
        setEditMode,
        highlight,
        setHighlight,
        setTheme,
      }}
    >
      <div data-mode={theme}>
        <div className="fixed -translate-x-1/2 z-overlay left-1/2 bottom-4">
          <ValMenu />
        </div>
        {editMode === "hover" && hoverTarget && (
          <ValHover
            hoverTarget={hoverTarget}
            setHoverTarget={setHoverTarget}
            setEditMode={setEditMode}
            setWindowTarget={setWindowTarget}
          />
        )}
        {editMode === "window" && windowTarget && (
          <ValWindow
            position={{
              left: windowTarget.mouse.x,
              top: windowTarget.mouse.y,
            }}
            onClose={() => {
              setWindowTarget(null);
              setEditMode("hover");
            }}
          >
            hei
          </ValWindow>
        )}
      </div>
    </ValOverlayContext.Provider>
  );
}

type WindowTarget = {
  element?: HTMLElement | undefined;
  mouse: { x: number; y: number };
  path: string;
};

type HoverTarget = {
  element?: HTMLElement | undefined;
  path: string;
};
function ValHover({
  hoverTarget,
  setEditMode,
  setWindowTarget,
  setHoverTarget,
}: {
  hoverTarget: HoverTarget;
  setEditMode: Dispatch<EditMode>;
  setHoverTarget: Dispatch<HoverTarget | null>;
  setWindowTarget: Dispatch<WindowTarget | null>;
}) {
  const rect = hoverTarget.element?.getBoundingClientRect();
  return (
    <div
      id="val-hover"
      className="fixed border cursor-pointer z-overlay-hover border-highlight"
      style={{
        top: rect?.top,
        left: rect?.left,
        width: rect?.width,
        height: rect?.height,
      }}
      onClick={(ev) => {
        setWindowTarget({
          ...hoverTarget,
          mouse: { x: ev.pageX, y: ev.pageY },
        });
        setEditMode("window");
        setHoverTarget(null);
      }}
    >
      <div className="flex justify-end w-full">
        <div className="px-3 py-1 text-xs rounded-bl-sm text-warm-black bg-highlight">
          Edit
        </div>
      </div>
    </div>
  );
}

// TODO: do something fun on highlight?
function useHighlight(
  highlight: boolean,
  setTarget: Dispatch<HoverTarget | null>
) {
  useEffect(() => {
    if (highlight) {
      const elements =
        document.querySelectorAll<HTMLElement>("[data-val-path]");
      let index = 0;
      let timeout: NodeJS.Timeout | null = null;

      const highlight = () => {
        const element = elements[index];
        const path = element.dataset.valPath;
        if (path) {
          setTarget({
            path,
            element,
          });
        }
        index++;
        if (index >= elements.length) {
          index = 0;
        }
        timeout = setTimeout(highlight, 1000);
      };
      highlight();
      return () => {
        if (timeout) {
          clearTimeout(timeout);
        }
      };
    }
  }, [highlight]);
}

const LOCAL_STORAGE_EDIT_MODE_KEY = "val-edit-mode";

function useInitEditMode() {
  const [editMode, setEditModeRaw] = useState<EditMode>("off");
  useEffect(() => {
    try {
      const storedEditMode = localStorage.getItem(LOCAL_STORAGE_EDIT_MODE_KEY);
      if (
        storedEditMode === "off" ||
        storedEditMode === "hover" ||
        storedEditMode === "window" ||
        storedEditMode === "full"
      ) {
        setEditModeRaw(storedEditMode);
      } else {
        localStorage.removeItem(LOCAL_STORAGE_EDIT_MODE_KEY);
        setEditModeRaw("off");
      }
    } catch (err) {
      setEditModeRaw("off");
    }
  }, []);

  const setEditMode: Dispatch<SetStateAction<EditMode>> = useCallback((v) => {
    if (typeof v === "function") {
      setEditModeRaw((prev) => {
        const next = v(prev);
        localStorage.setItem(
          LOCAL_STORAGE_EDIT_MODE_KEY,
          next ? "true" : "false"
        );
        return next;
      });
    } else {
      localStorage.setItem(LOCAL_STORAGE_EDIT_MODE_KEY, v ? "true" : "false");
      setEditModeRaw(v);
    }
  }, []);
  return [editMode, setEditMode] as const;
}

function useHoverTarget(editMode: EditMode) {
  const [target, setTarget] = useState<{
    element?: HTMLElement;
    rect?: DOMRect;
    path: string;
  } | null>(null);
  useEffect(() => {
    if (editMode === "hover") {
      let curr: HTMLElement | null = null;
      const mouseOverListener = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        curr = target;
        // TODO: use .contains?
        do {
          if (curr?.dataset.valPath) {
            setTarget({
              element: curr,
              path: curr.dataset.valPath,
            });
            break;
          }
        } while ((curr = curr?.parentElement || null));
      };
      const scrollListener = () => {
        if (target?.element) {
          setTarget({
            ...target,
          });
        }
      };

      document.addEventListener("mouseover", mouseOverListener);
      document.addEventListener("scroll", scrollListener, { passive: true });

      return () => {
        setTarget(null);
        document.removeEventListener("mouseover", mouseOverListener);
        document.removeEventListener("scroll", scrollListener);
      };
    }
  }, [editMode]);

  return [target, setTarget] as const;
}

function useTheme(defaultTheme: Theme = "dark") {
  const [theme, setTheme] = useState<Theme>(defaultTheme);

  useEffect(() => {
    if (localStorage.getItem("val-theme") === "light") {
      setTheme("light");
    } else if (localStorage.getItem("val-theme") === "dark") {
      setTheme("dark");
    } else if (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      setTheme("dark");
    } else if (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: light)").matches
    ) {
      setTheme("light");
    }
    const themeListener = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem("val-theme")) {
        setTheme(e.matches ? "dark" : "light");
      }
    };
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", themeListener);
    return () => {
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .removeEventListener("change", themeListener);
    };
  }, []);

  return [
    theme,
    (theme: Theme) => {
      localStorage.setItem("val-theme", theme);
      setTheme(theme);
    },
  ] as const;
}

function useSession(api: FetchApi) {
  const [session, setSession] = useState<Remote<Session>>({
    status: "not-asked",
  });
  const [sessionResetId, setSessionResetId] = useState(0);
  useEffect(() => {
    setSession({ status: "loading" });
    api.getSession().then(async (res) => {
      try {
        if (res.status === 200) {
          const session = await res.json();
          setSession({ status: "success", data: Session.parse(session) });
        } else {
          if (sessionResetId < 3) {
            setTimeout(() => {
              setSessionResetId(sessionResetId + 1);
            }, 200 * sessionResetId);
          } else {
            setSession({ status: "error", error: "Could not fetch session" });
          }
        }
      } catch (e) {
        setSession({
          status: "error",
          error: "Got an error while trying to get session",
        });
      }
    });
  }, [sessionResetId]);
  return session;
}

import { useEffect, useState } from "react";
import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { ValModulesClient, ValProvider } from "@valbuild/tanstack";
import { config } from "../../val.config";
import valModules from "../../val.modules";
import siteVal from "../content/site.val";
import { useVal } from "../val/client";
import { isDemo } from "../demo";

/** The site's layout: everything except the Studio at `/val`. */
export const Route = createFileRoute("/_site")({
  component: SiteLayout,
});

function SiteLayout() {
  return (
    // `demo`: in the Studio's canvas this page is always the draft, and
    // everywhere else Val stays out of the way. See `ValProvider`.
    <ValProvider config={config} demo={isDemo}>
      <ValModulesClient modules={valModules} />
      <Chrome>
        <Outlet />
      </Chrome>
    </ValProvider>
  );
}

/**
 * Whether this page is in a frame: the Studio's canvas. Read after mounting,
 * so the server's render and the first one in the browser agree.
 */
function useInFrame(): boolean {
  const [inFrame, setInFrame] = useState(false);
  useEffect(() => {
    setInFrame(window.self !== window.top);
  }, []);
  return inFrame;
}

function Chrome({ children }: { children: React.ReactNode }) {
  const site = useVal(siteVal);
  // In the canvas the Studio is already open around the page.
  const inFrame = useInFrame();
  return (
    <>
      <header className="site-header">
        <Link to="/" className="site-name">
          {site.name}
        </Link>
        <nav>
          {site.menu.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
      </header>
      {children}
      <footer className="site-footer">
        <p>{site.footer}</p>
        {!inFrame && (
          <p>
            <a href="/val">Open the Studio</a>
          </p>
        )}
      </footer>
    </>
  );
}

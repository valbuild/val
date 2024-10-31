import { NavMenu } from "./components/NavMenu";
import { ToolsMenu } from "./components/ToolsMenu";
import { ContentArea } from "./components/ContentArea";
import classNames from "classnames";
import { useTheme } from "./ValProvider";
import { useEffect, useState } from "react";
import { useNavigation } from "../components/ValRouter";

export function Layout() {
  const theme = useTheme();
  const [didInitialise, setDidInitialise] = useState(false);
  const [isNavMenuOpen, setIsNavMenuOpen] = useState(true);
  const [isToolsMenuOpen, setIsToolsMenuOpen] = useState(false);
  const { currentSourcePath } = useNavigation();
  useEffect(() => {
    if (!didInitialise && currentSourcePath) {
      setDidInitialise(true);
      setIsNavMenuOpen(false);
    }
  }, [didInitialise, currentSourcePath]);
  return (
    <main
      className={classNames("font-sans bg-bg-primary text-text-primary")}
      {...(theme ? { "data-mode": theme } : {})}
    >
      <div className="fixed top-0 left-0 ml-auto w-[320px] z-[5]">
        <NavMenu
          isOpen={isNavMenuOpen}
          setOpen={(open) => {
            setIsNavMenuOpen(open);
            setIsToolsMenuOpen(false);
          }}
        />
      </div>
      <div className="w-[calc(100%-16px*2)] mx-auto xl:w-[calc(100%-320px*2-32px*2)] max-w-[800px] min-h-screen">
        <ContentArea />
      </div>
      <div className="fixed top-0 right-0 mr-auto w-[320px] z-[5]">
        <ToolsMenu
          isOpen={isToolsMenuOpen}
          setOpen={(open) => {
            setIsToolsMenuOpen(open);
            setIsNavMenuOpen(false);
          }}
        />
      </div>
    </main>
  );
}

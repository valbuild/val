import { NavMenu } from "./components/NavMenu";
import { ToolsMenu } from "./components/ToolsMenu";
import { ContentArea } from "./components/ContentArea";
import classNames from "classnames";
import { useTheme } from "./ValProvider";

export function Layout() {
  const theme = useTheme();
  return (
    <main
      className={classNames("font-sans bg-bg-primary text-text-primary")}
      {...(theme ? { "data-mode": theme } : {})}
    >
      <div className="fixed top-0 left-0 ml-auto w-[320px]">
        <NavMenu />
      </div>
      <div className="w-full mx-auto xl:w-[calc(100%-320px*2)] xl:max-w-[800px] min-h-screen">
        <ContentArea />
      </div>
      <div className="fixed top-0 right-0 mr-auto w-[320px]">
        <ToolsMenu />
      </div>
    </main>
  );
}

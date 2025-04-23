import { ScrollArea } from "./designSystem/scroll-area";
import { Module } from "./Module";
import { PanelRightOpen, Search } from "lucide-react";
import { useNavigation } from "./ValRouter";
import { useConnectionStatus, useNetworkError } from "./ValProvider";
import { useLayout } from "./Layout";
import classNames from "classnames";

export function ContentArea() {
  const connectionStatus = useConnectionStatus();
  const networkError = useNetworkError();
  return (
    <>
      <ContentAreaHeader />
      <ScrollArea viewportId="val-content-area">
        {networkError !== null && (
          <>
            <div className="w-full h-16"></div>
            <div className="absolute w-full h-16 top-0 p-4 text-center text-white bg-bg-error-primary z-[10]">
              Network error - retrying...
            </div>
          </>
        )}
        <div className="max-h-[calc(100svh-64px)] max-w-[800px] px-4 mx-auto">
          {connectionStatus === "service-unavailable" ? (
            <div className="p-8 mt-20 text-center text-text-error-primary bg-bg-error-primary">
              <p>Could not connect to the content service.</p>
              <p>Please try again later</p>
            </div>
          ) : (
            <SourceFields />
          )}
        </div>
      </ScrollArea>
    </>
  );
}

function ContentAreaHeader() {
  const { navMenu, toolsMenu } = useLayout();
  return (
    <div className="flex items-center justify-between w-full h-16 px-4 border-b border-border-primary">
      <button
        className={classNames({
          "ml-[calc(320px+0.5rem)] xl:ml-0": navMenu.isOpen,
          "hidden lg:inline": navMenu.isOpen || toolsMenu.isOpen,
        })}
        onClick={() => navMenu.setOpen(!navMenu.isOpen)}
      >
        <PanelRightOpen
          size={16}
          className={classNames("transform", {
            "rotate-180": !navMenu.isOpen,
          })}
        />
      </button>
      <button
        className={classNames({
          "mr-[calc(320px+0.5rem)] xl:mr-0": toolsMenu.isOpen,
          "hidden lg:inline": navMenu.isOpen || toolsMenu.isOpen,
        })}
        onClick={() => toolsMenu.setOpen(!toolsMenu.isOpen)}
      >
        <PanelRightOpen
          size={16}
          className={classNames("transform", {
            "rotate-180": toolsMenu.isOpen,
          })}
        />
      </button>
    </div>
  );
}

export function SearchBar() {
  return (
    <div className="sticky top-0 text-text-primary z-[2] pt-4 hidden xl:block">
      <div className="grid grid-cols-[min-content,1fr,min-content] items-center xl:w-[calc(100%-16px)] ml-2 h-16 p-4 bg-bg-tertiary rounded-3xl">
        <Search size={22} />
        <input
          className="w-full h-full px-4 text-lg bg-transparent text-text-primary focus:outline-none"
          onClick={() => {
            // setSearch({ filter: "" });
          }}
        />
        <div>⌘K</div>
      </div>
    </div>
  );
}

function SourceFields() {
  const { currentSourcePath } = useNavigation();
  const path = currentSourcePath;
  return <Module path={path} />;
}

// export function PathBar() {
//   const { currentSourcePath } = useNavigation();
//   const maybeSplitPaths =
//     currentSourcePath &&
//     Internal.splitModuleFilePathAndModulePath(
//       currentSourcePath as unknown as SourcePath,
//     );
//   if (!maybeSplitPaths) {
//     return null;
//   }
//   const [moduleFilePath, modulePath] = maybeSplitPaths;
//   const moduleFilePathParts = moduleFilePath.split("/").slice(1);
//   const modulePathParts = modulePath
//     ? Internal.splitModulePath(modulePath)
//     : [];
//   return (
//     <div className="flex items-center gap-2">
//       {moduleFilePathParts.map((part, i) => (
//         <Fragment key={`${part}-${i}`}>
//           <span
//             className={classNames({
//               "text-fg-tertiary": !(
//                 modulePathParts.length === 0 &&
//                 i === moduleFilePathParts.length - 1
//               ),
//             })}
//           >
//             {prettifyFilename(part)}
//           </span>
//           {i < moduleFilePathParts.length - 1 &&
//             !(
//               i === moduleFilePathParts.length - 1 && modulePathParts.length > 0
//             ) && (
//               <span className="text-fg-tertiary">
//                 <ChevronRight size={16} />
//               </span>
//             )}
//         </Fragment>
//       ))}
//       {modulePathParts.map((part, i) => (
//         <Fragment key={`${part}-${i}`}>
//           <span className="text-fg-tertiary">
//             <ChevronRight size={16} />
//           </span>
//           <span
//             className={classNames({
//               "text-fg-tertiary": i === modulePathParts.length - 2,
//             })}
//           >
//             {prettifyFilename(part)}
//           </span>
//         </Fragment>
//       ))}
//     </div>
//   );
// }

import { ScrollArea } from "./designSystem/scroll-area";
import { Module } from "./Module";
import { CopyIcon, PanelRightOpen, Search } from "lucide-react";
import { useNavigation } from "./ValRouter";
import {
  useConnectionStatus,
  useGlobalError,
  useValPortal,
} from "./ValProvider";
import { useLayout } from "./Layout";
import classNames from "classnames";
import ExhaustiveCheck from "./ExhaustiveCheck";
import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "./designSystem/dialog";
import { Button } from "./designSystem/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./designSystem/accordion";

export function ContentArea() {
  const connectionStatus = useConnectionStatus();
  const globalError = useGlobalError();
  return (
    <>
      <ContentAreaHeader />
      <ScrollArea viewportId="val-content-area">
        {globalError !== null && (
          <>
            {globalError.type === "network-error" ? (
              <>
                <div className="absolute w-full h-16 top-0 p-4 text-center text-fg-error-primary bg-bg-error-primary z-[50]">
                  Network error - retrying...
                </div>
              </>
            ) : globalError.type === "remote-files-error" ? (
              <RemoteFilesErrorDialog error={globalError} />
            ) : (
              <ExhaustiveCheck value={globalError} />
            )}
          </>
        )}
        <div className="max-h-[calc(100svh-64px)] max-w-[800px] px-4 mx-auto">
          {connectionStatus === "service-unavailable" ? (
            <div className="p-8 mt-20 text-center text-fg-error-primary bg-bg-error-primary">
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

function RemoteFilesErrorDialog({
  error,
}: {
  error: { type: "remote-files-error"; error: string };
}) {
  const portalContainer = useValPortal();
  return (
    <Dialog defaultOpen={true}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent
          container={portalContainer}
          className="max-w-lg p-6 rounded-lg bg-bg-primary text-fg-primary"
        >
          <DialogTitle className="text-lg font-medium mb-4">
            Personal access token file required
          </DialogTitle>
          <div>
            <p>
              This project uses remote files, which means you need to be
              authenticated to update them.
            </p>
            <p>
              To do this locally in this dev environment, you need a Personal
              Access Token (PAT) stored in a file.
            </p>
            <p>
              Run the command in the root directory of your project to create
              the token file.
            </p>
          </div>
          <CopyableCodeBlock code="npx -p @valbuild/cli val login" />
          <div>
            <Accordion type="multiple">
              <AccordionItem value="why-pat">
                <AccordionTrigger>Why a personal token file?</AccordionTrigger>
                <AccordionContent>
                  <p>
                    Remote files are stored in a remote file server that
                    requires authentication. A personal access token (PAT) is a
                    secure way to authenticate and update remote files.
                  </p>
                  <p>
                    Note: this is only required in local development. In
                    production, users are authenticated through the application.
                  </p>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="details">
                <AccordionTrigger>More details</AccordionTrigger>
                <AccordionContent>
                  <p>The underlying error message was: "{error.error}".</p>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

function CopyableCodeBlock({ code }: { code: string }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
  };
  return (
    <div className="relative bg-bg-secondary rounded-md p-4 my-4">
      <pre className="overflow-x-auto">
        <code>{code}</code>
      </pre>
      <Button
        variant="secondary"
        size="sm"
        className="absolute top-2 right-2"
        onClick={handleCopy}
      >
        <CopyIcon size={16} className="mr-2" />
      </Button>
    </div>
  );
}

function ContentAreaHeader() {
  const { navMenu, toolsMenu } = useLayout();
  return (
    <div className="flex justify-between items-center px-4 w-full h-16 border-b border-border-primary">
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
    <div className="sticky top-0 text-fg-primary z-[2] pt-4 hidden xl:block">
      <div className="grid grid-cols-[min-content,1fr,min-content] items-center xl:w-[calc(100%-16px)] ml-2 h-16 p-4 bg-bg-tertiary rounded-3xl">
        <Search size={22} />
        <input
          className="px-4 w-full h-full text-lg bg-transparent text-fg-primary focus:outline-none"
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
//     <div className="flex gap-2 items-center">
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

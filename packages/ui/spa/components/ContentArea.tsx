import { useMemo } from "react";
import { ScrollArea } from "./designSystem/scroll-area";
import { Module } from "./Module";
import { CopyIcon, PanelRightOpen, Search as SearchIcon } from "lucide-react";
import { useNavigation } from "./ValRouter";
import { Search } from "./Search";
import {
  useConnectionStatus,
  useGlobalError,
  usePatchSets,
  useProfilesByAuthorId,
  useValMode,
} from "./ValProvider";
import {
  ComparePatchSets,
  CompareSummaryStrip,
  flattenChanges,
} from "./ComparePatchSets";
import { usePatchSetsWorker } from "../patchsets/usePatchSetsWorker";
import { useValPortal } from "./ValPortalProvider";
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
  const { isCompareView } = useNavigation();
  return (
    <div className="flex flex-col h-svh bg-bg-primary">
      <ContentAreaHeader />
      <ScrollArea viewportId="val-content-area" className="flex-1 min-h-0" orientation={isCompareView ? "both" : undefined}>
        {globalError !== null && (
          <>
            {globalError.type === "network-error" ? (
              <>
                <div className="absolute w-full h-16 top-0 p-4 text-center text-fg-error-primary bg-bg-error-primary z-[50]">
                  Network error - retrying...
                </div>
              </>
            ) : globalError.type === "schema-error" ? (
              <>
                <div className="absolute w-full h-16 top-0 p-4 text-center text-fg-error-primary bg-bg-error-primary z-[50]">
                  Schema error - check your console for details
                </div>
              </>
            ) : globalError.type === "profiles-auth-error" ? (
              <>
                <div className="absolute w-full h-16 top-0 p-4 text-center text-fg-error-primary bg-bg-error-primary z-[50]">
                  Could not authenticate with your personal access token while
                  getting profiles.
                </div>
              </>
            ) : globalError.type === "remote-files-error" ? (
              <RemoteFilesErrorDialog error={globalError} />
            ) : (
              <ExhaustiveCheck value={globalError} />
            )}
          </>
        )}
        <div
          className={
            isCompareView
              ? "h-full max-w-[1400px] px-4 pt-6 mx-auto"
              : "h-full max-w-[800px] px-4 mx-auto"
          }
        >
          {connectionStatus === "service-unavailable" ? (
            <div className="p-8 mt-20 text-center text-fg-error-primary bg-bg-error-primary">
              <p>Could not connect to the content service.</p>
              <p>Please try again later</p>
            </div>
          ) : isCompareView ? (
            <CompareView />
          ) : (
            <SourceFields />
          )}
        </div>
      </ScrollArea>
    </div>
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
                    You are using remote files, which require authentication. In
                    local development, Val uses a personal access token (PAT) to
                    authenticate and allow you to update remote files.
                  </p>
                  <p>
                    You can create it by running the command shown above, which
                    will create a PAT file.
                  </p>
                  <p>
                    If you have the PAT already, check that you have internet
                    access and that the project is setup correctly in
                    https://admin.val.build, as issues with either of those
                    could also cause this error.
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
  const { currentSourcePath, isCompareView } = useNavigation();
  const isHome = (currentSourcePath?.length || 0) === 0;

  return (
    <div className="flex justify-between items-center px-4 w-full h-16 border-b border-border-primary overflow-visible relative z-10">
      <button
        className={classNames({
          "ml-[calc(320px+0.5rem)] xl:ml-0 hidden xl:block": navMenu.isOpen,
        })}
        onClick={() => navMenu.setOpen(!navMenu.isOpen)}
      >
        <PanelRightOpen
          size={16}
          className={classNames("transform duration-100 ease-linear", {
            "-rotate-180": !navMenu.isOpen,
          })}
        />
      </button>
      {isCompareView ? (
        <div className="flex-1 mx-4 min-w-0">
          <CompareSummaryInHeader />
        </div>
      ) : (
        !isHome && (
          <div className="flex-1 max-w-md mx-4 overflow-visible">
            <Search />
          </div>
        )
      )}
      <button
        className={classNames({
          "mr-[calc(320px+0.5rem)] xl:mr-0 hidden xl:block": toolsMenu.isOpen,
        })}
        onClick={() => toolsMenu.setOpen(!toolsMenu.isOpen)}
      >
        <PanelRightOpen
          size={16}
          className={classNames("transform duration-100 ease-linear", {
            "-rotate-180": toolsMenu.isOpen,
          })}
        />
      </button>
    </div>
  );
}

function CompareSummaryInHeader() {
  const patchSetsResult = usePatchSets();
  const profilesByAuthorIds = useProfilesByAuthorId();
  const mode = useValMode();
  const portalContainer = useValPortal();

  const patchSets = patchSetsResult.status === "success" ? patchSetsResult.data : [];
  const { trees } = usePatchSetsWorker(patchSets);

  const flatRows = useMemo(() => trees.flatMap(flattenChanges), [trees]);

  const allPatchIds = useMemo(() => {
    const ids: import("@valbuild/core").PatchId[] = [];
    const seen = new Set<string>();
    for (const row of flatRows) {
      for (const id of row.change?.patchIds ?? []) {
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    }
    return ids;
  }, [flatRows]);

  const allAuthorIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const row of flatRows) {
      for (const id of row.change?.authors ?? []) {
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    }
    return ids;
  }, [flatRows]);

  if (patchSetsResult.status !== "success") {
    return null;
  }

  return (
    <CompareSummaryStrip
      authorIds={allAuthorIds}
      profilesByAuthorIds={profilesByAuthorIds}
      mode={mode}
      allPatchIds={allPatchIds}
      readonly={false}
      portalContainer={portalContainer}
    />
  );
}

export function SearchBar() {
  return (
    <div className="sticky top-0 text-fg-primary z-[2] pt-4 hidden xl:block">
      <div className="grid grid-cols-[min-content,1fr,min-content] items-center xl:w-[calc(100%-16px)] ml-2 h-16 p-4 bg-bg-tertiary rounded-3xl">
        <SearchIcon size={22} />
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
  return <Module path={currentSourcePath} showModuleGalleryChild={null} />;
}

function CompareView() {
  const patchSetsResult = usePatchSets();
  const profilesByAuthorIds = useProfilesByAuthorId();
  const mode = useValMode();
  if (patchSetsResult.status === "not-asked") {
    return (
      <div className="text-sm text-fg-secondary py-8 text-center animate-pulse">
        Loading changes&hellip;
      </div>
    );
  }
  if (patchSetsResult.status === "error") {
    return (
      <div className="text-sm text-fg-error py-8 text-center">
        Failed to load changes: {patchSetsResult.error}
      </div>
    );
  }
  return (
    <ComparePatchSets
      patchSets={patchSetsResult.data}
      profilesByAuthorIds={profilesByAuthorIds}
      mode={mode}
      readonly={false}
    />
  );
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

import { ChevronRight, ChevronsUpDown, Search } from "lucide-react";
import classNames from "classnames";
import React, { Fragment } from "react";
import { Internal, SourcePath } from "@valbuild/core";
import { Module } from "./components/Module";
import { useNavigation } from "../components/ValRouter";
import { Author } from "./components/Author";
import { NavMenu } from "./components/NavMenu";
import { PathBar } from "./components/PathBar";

export function Layout() {
  return (
    <main className="bg-bg-primary">
      <div className="fixed top-4 left-4 w-[320px] hidden md:block">
        <HeaderLeft />
        <div className="flex flex-col justify-between pb-4 pb- ml-4 text-xs h-fit max-h-[max(100vh-84px,112px)] bg-bg-secondary rounded-b-3xl">
          <NavMenu className="max-h-[max(100vh-112px-32px,112px-32px)]" />
        </div>
      </div>
      <div className="mx-auto w-full md:w-[calc(100%-320*2px)] max-w-[600px] min-h-screen">
        <HeaderCenter />
        <Center />
      </div>
      <div className="fixed top-4 right-4 w-[320px] hidden md:block">
        <HeaderRight />
        <Right />
      </div>
    </main>
  );
}

function HeaderLeft() {
  return (
    <div className="flex items-center gap-2 px-5 pt-4 ml-4 text-xs bg-bg-secondary rounded-t-3xl">
      <Author size="md" />
      <List />
    </div>
  );
}

function List() {
  return (
    <button className="flex items-center justify-between w-full px-4 py-2 text-xs rounded-3xl bg-bg-secondary">
      <span>Blank Oslo</span>
      <ChevronsUpDown size={12} />
    </button>
  );
}

function HeaderCenter() {
  // const { search, setSearch } = useSearch();
  // const [query, setQuery] = useState("");
  // useEffect(() => {
  //   // debounce:
  //   const timeout = setTimeout(() => {
  //     if (query.includes("@error")) {
  //       setSearch({
  //         type: "error",
  //         filter: query.replace("@error", "").trim(),
  //       });
  //     } else if (query.includes("@change")) {
  //       setSearch({
  //         type: "change",
  //         filter: query.replace("@change", "").trim(),
  //       });
  //     } else {
  //       setSearch({ filter: query.trim() });
  //     }
  //   }, 250);
  //   return () => clearTimeout(timeout);
  // }, [query]);

  // if (search) {
  //   return (
  //     <HeaderCenterContainer>
  //       <Search size={22} />
  //       <input
  //         className="px-2 bg-transparent focus:outline-none w-[calc(100%-48px)]"
  //         value={query}
  //         onChange={(e) => {
  //           setQuery(e.target.value);
  //         }}
  //         autoFocus
  //       ></input>
  //       <button
  //         onClick={() => {
  //           setSearch(false);
  //         }}
  //       >
  //         <X />
  //       </button>
  //     </HeaderCenterContainer>
  //   );
  // }
  return (
    <HeaderCenterContainer>
      <button
        className="flex items-center justify-between w-full h-full"
        onClick={() => {
          // setSearch({ filter: "" });
        }}
      >
        <div className="flex items-center h-full pr-4 border-r border-border">
          <Search size={22} />
        </div>
        <PathBar />
        <div>⌘K</div>
      </button>
    </HeaderCenterContainer>
  );
}

function HeaderCenterContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 mx-auto mt-4 mb-10 text-sm">
      <div className="flex items-center justify-between px-4 rounded-2xl bg-bg-secondary font-[SpaceGrotesk] h-12 border border-border-primary">
        {children}
      </div>
    </div>
  );
}

function Center() {
  // const { search } = useSearch();
  // if (search) {
  //   return (
  //     <SearchFields
  //       type={search.type}
  //       sourcePath={search.sourcePath}
  //       filter={search.filter}
  //     />
  //   );
  // }
  return <SourceFields />;
}

// function SearchFields({
//   sourcePath,
//   filter,
// }: {
//   type?: "change" | "error";
//   sourcePath?: SourcePath;
//   filter?: string;
// }) {
//   const results = useSearchResults({
//     query: (sourcePath || "") + " " + (filter || ""),
//     patches: [], // TODO: get patches
//   });
//   if (results.status === "error") {
//     throw new Error(results.error);
//   }
//   if (results.status !== "success") {
//     return <Loading />;
//   }
//   return (
//     <div className="flex flex-col gap-10 pt-4">
//       {results.data.map((result) => {
//         return <SearchField key={result.sourcePath} path={result.sourcePath} />;
//       })}
//     </div>
//   );
// }
// function SearchField({ path }: { path: SourcePath }) {
//   const res = useModuleSourceAndSchema(path);
//   if (res.status === "error") {
//     throw new Error(res.error);
//   }
//   if (res.status !== "success") {
//     return <Loading />;
//   }
//   const { source, schema, moduleFilePath, modulePath } = res.data;
//   return (
//     <Field
//       label={
//         <span className="inline-block">
//           <CompressedPath
//             moduleFilePath={moduleFilePath}
//             modulePath={modulePath}
//           ></CompressedPath>
//         </span>
//       }
//       path={path}
//     >
//       <Module path={path} source={source} schema={deserializeSchema(schema)} />
//     </Field>
//   );
// }

function SourceFields() {
  const { currentSourcePath } = useNavigation();
  const path = currentSourcePath as unknown as SourcePath;
  return (
    <div className="flex flex-col gap-4 p-4 mb-4 rounded-b-2xl">
      <div className="flex flex-col w-full gap-12">
        <Module path={path} />
      </div>
    </div>
  );
}

// function EmptyContent() {
//   return (
//     <div className="p-4 mx-4 mb-4 rounded-b-2xl bg-primary-foreground">
//       Nothing selected
//     </div>
//   );
// }

function HeaderRight() {
  return <div>TODO</div>;
  // const { patches } = usePatches();
  // const { errors } = useErrors();
  // let publishDisabled = false;
  // if (patches.status !== "success") {
  //   publishDisabled = true;
  // }
  // if (patches.status === "success") {
  //   publishDisabled = Object.keys(patches.data).length === 0;
  // }
  // if (errors.status !== "success") {
  //   publishDisabled = true;
  // }
  // if (errors.status === "success") {
  //   publishDisabled = Object.keys(errors.data).length > 0;
  // }
  // return (
  //   <div className="flex items-center justify-end gap-2 p-4 mb-1 text-sm bg-bg-secondary rounded-3xl">
  //     <Button disabled={publishDisabled}>Publish</Button>
  //   </div>
  // );
}

function Right() {
  return (
    <div className="flex flex-col gap-1">
      <ValidationErrors />
      <PendingChanges />
    </div>
  );
}

// function CompressedPath({
//   moduleFilePath,
//   modulePath,
// }: {
//   moduleFilePath: ModuleFilePath;
//   modulePath: ModulePath;
// }) {
//   const moduleFilePathParts = moduleFilePath.split("/"); // TODO: create a function to split module file paths properly
//   const modulePathParts = Internal.splitModulePath(modulePath);
//   const { navigate } = useNavigation();
//   return (
//     <div
//       title={Internal.joinModuleFilePathAndModulePath(
//         moduleFilePath,
//         modulePath,
//       )}
//     >
//       <button
//         className="inline-block w-1/2 text-left truncate"
//         onClick={() => {
//           navigate(moduleFilePath);
//         }}
//       >
//         {moduleFilePathParts.map((part, i) => (
//           <Fragment key={`${part}-${i}`}>
//             <span
//               className={classNames({
//                 "text-muted": !(
//                   modulePathParts.length === 0 &&
//                   i === moduleFilePathParts.length - 1
//                 ),
//               })}
//             >
//               {prettifyFilename(part)}
//             </span>
//             {i > 0 && i < moduleFilePathParts.length - 1 && (
//               <span className="text-muted">/</span>
//             )}
//           </Fragment>
//         ))}
//       </button>
//       <button
//         className="inline-block w-1/2 text-left truncate"
//         onClick={() => {
//           navigate(
//             Internal.joinModuleFilePathAndModulePath(
//               moduleFilePath,
//               modulePath,
//             ),
//           );
//         }}
//       >
//         {modulePathParts.map((part, i) => (
//           <Fragment key={`${part}-${i}`}>
//             <span className="text-muted">/</span>
//             <span
//               className={classNames({
//                 "text-muted": i === modulePathParts.length - 2,
//               })}
//             >
//               {prettifyFilename(part)}
//             </span>
//           </Fragment>
//         ))}
//       </button>
//     </div>
//   );
// }

function ValidationErrors() {
  return <div>TODO</div>;
  //   const { errors } = useErrors();
  //   const errorSourcePaths = useMemo((): Remote<SourcePath[]> => {
  //     if (errors.status === "success") {
  //       return {
  //         status: "success",
  //         data: Object.keys(errors.data) as SourcePath[],
  //       };
  //     } else {
  //       return errors;
  //     }
  //   }, [errors]);
  //   if (errorSourcePaths.status === "error") {
  //     throw new Error(errorSourcePaths.error);
  //   }
  //   if (errorSourcePaths.status !== "success") {
  //     return <Loading />;
  //   }
  //   if (errorSourcePaths.data.length === 0) {
  //     return null;
  //   }
  //   return (
  //     <div className="py-4 rounded-3xl bg-bg-secondary">
  //       <ScrollArea className="max-h-[max(50vh-40px,200px)] overflow-scroll">
  //         <div className="flex items-center gap-2 px-4">
  //           <ErrorsAmountBadge amount={errorSourcePaths.data.length} />
  //           <span className="font-bold">Errors</span>
  //         </div>
  //         <Divider />
  //         <div className="flex flex-col px-4">
  //           {errorSourcePaths.data.map((errorSourcePath) => {
  //             return (
  //               <ValidationErrorCard
  //                 key={errorSourcePath}
  //                 sourcePath={errorSourcePath}
  //               />
  //             );
  //           })}
  //         </div>
  //       </ScrollArea>
  //       <Divider />
  //       <button
  //         className="flex items-center justify-between w-full px-4 text-left"
  //         onClick={() => {
  //           // setSearch({ type: "error" });
  //         }}
  //       >
  //         <span>See all errors</span>
  //         <span>
  //           <ArrowRight size={16} />
  //         </span>
  //       </button>
  //     </div>
  //   );
}

// function ValidationErrorCard({ sourcePath }: { sourcePath: SourcePath }) {
//   const [moduleFilePath, modulePath] =
//     Internal.splitModuleFilePathAndModulePath(sourcePath);
//   const { title, subTitle } = getTitles(
//     moduleFilePath,
//     Internal.splitModulePath(modulePath),
//   );
//   const { setSearch } = useSearch();
//   return (
//     <div className="py-3">
//       <button
//         className="flex items-center gap-2 text-left"
//         onClick={() => {
//           setSearch({ type: "error", sourcePath });
//         }}
//       >
//         <span>{title}</span>
//       </button>
//       <button
//         className="text-left"
//         onClick={() => {
//           setSearch({
//             type: "error",
//             sourcePath: Internal.parentOfSourcePath(sourcePath),
//           });
//         }}
//       >
//         <SubTitle subTitle={subTitle} />
//       </button>
//     </div>
//   );
// }

// function ErrorsAmountBadge({ amount }: { amount: number }) {
//   return (
//     <div className="h-6 leading-6 text-center min-w-8 rounded-xl bg-bg-error-primary text-text-secondary">
//       {amount}
//     </div>
//   );
// }

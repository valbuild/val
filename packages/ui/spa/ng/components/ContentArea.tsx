import { ScrollArea } from "../../components/ui/scroll-area";
import { Module } from "./Module";
import { Search } from "lucide-react";
import { useNavigation } from "../../components/ValRouter";

export function ContentArea() {
  return (
    <ScrollArea>
      <div className="max-h-[100svh]">
        <SearchBar />
        <SourceFields />
      </div>
    </ScrollArea>
  );
}

export function SearchBar() {
  return (
    <div className="sticky top-0 text-text-primary z-[2] pt-4">
      <div className="grid grid-cols-[min-content,1fr,min-content] items-center  w-[calc(100%-16px)] ml-2 h-16 p-4 bg-bg-tertiary rounded-3xl">
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

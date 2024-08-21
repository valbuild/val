import { SourcePath, ModuleFilePath, Internal } from "@valbuild/core";
import classNames from "classnames";
import { Path } from "../studio/Path";
import { useNavigate } from "../ValRouter";

function dirPaths(paths: string[]): Record<string, string[]> {
  const res: Record<string, string[]> = {};
  paths.forEach((path) => {
    const allParts = path.split("/").filter((part) => part !== "");
    if (allParts.length === 1) {
      if (!res[""]) {
        res[""] = [];
      }
      res[""].push(allParts[0]);
    } else if (allParts.length > 1) {
      const dir = allParts.slice(0, allParts.length - 1).join("/");
      const file = allParts.slice(-1)[0];
      if (!res[dir]) {
        res[dir] = [];
      }
      res[dir].push(file);
    }
  });
  return res;
}

export function PathTree({
  selectedPath,
  paths,
}: {
  selectedPath: SourcePath | ModuleFilePath | undefined;
  paths: string[];
}): React.ReactElement {
  const tree = dirPaths(paths);
  const selectedModuleId =
    selectedPath &&
    Internal.splitModuleFilePathAndModulePath(selectedPath as SourcePath)[0];
  const navigate = useNavigate();
  return (
    <div className="flex flex-col w-full py-2 text-xs">
      {Object.entries(tree).map(([dir, files]) => {
        return (
          <div className="px-4 py-2" key={`/${dir}`}>
            {dir && (
              <div
                className="font-bold truncate max-w-[300px] text-left"
                title={dir}
              >
                <Path>{dir}</Path>
              </div>
            )}
            <div
              className={classNames({
                "flex flex-col py-2 justify-start items-start": !!dir,
              })}
            >
              {files.map((file) => {
                const moduleFilePath = `/${dir}/${file}` as ModuleFilePath;
                return (
                  <button
                    key={moduleFilePath}
                    className={classNames("block px-2 py-1 rounded-full", {
                      "bg-accent text-accent-foreground":
                        selectedModuleId === moduleFilePath,
                    })}
                    onClick={() => {
                      navigate(moduleFilePath);
                    }}
                  >
                    {file}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

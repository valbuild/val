import { Internal, SourcePath } from "@valbuild/core";
import classNames from "classnames";
import { ChevronRight } from "lucide-react";
import { Fragment } from "react";
import { useNavigation } from "../../components/ValRouter";
import { prettifyFilename } from "../../utils/prettifyFilename";

export function PathBar() {
  const { currentSourcePath } = useNavigation();
  const maybeSplitPaths =
    currentSourcePath &&
    Internal.splitModuleFilePathAndModulePath(
      currentSourcePath as unknown as SourcePath,
    );
  if (!maybeSplitPaths) {
    return null;
  }
  const [moduleFilePath, modulePath] = maybeSplitPaths;
  const moduleFilePathParts = moduleFilePath.split("/").slice(1);
  const modulePathParts = modulePath
    ? Internal.splitModulePath(modulePath)
    : [];
  return (
    <div className="flex items-center gap-2">
      {moduleFilePathParts.map((part, i) => (
        <Fragment key={`${part}-${i}`}>
          <span
            className={classNames({
              "text-fg-tertiary": !(
                modulePathParts.length === 0 &&
                i === moduleFilePathParts.length - 1
              ),
            })}
          >
            {prettifyFilename(part)}
          </span>
          {i < moduleFilePathParts.length - 1 &&
            !(
              i === moduleFilePathParts.length - 1 && modulePathParts.length > 0
            ) && (
              <span className="text-fg-tertiary">
                <ChevronRight size={16} />
              </span>
            )}
        </Fragment>
      ))}
      {modulePathParts.map((part, i) => (
        <Fragment key={`${part}-${i}`}>
          <span className="text-fg-tertiary">
            <ChevronRight size={16} />
          </span>
          <span
            className={classNames({
              "text-fg-tertiary": i === modulePathParts.length - 2,
            })}
          >
            {prettifyFilename(part)}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

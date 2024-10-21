import { Internal, SourcePath } from "@valbuild/core";
import classNames from "classnames";
import { Fragment } from "react";
import { prettifyFilename } from "../../utils/prettifyFilename";
import { useNavigation } from "../../components/ValRouter";

export function CompressedPath({
  path,
  disabled,
}: {
  path: SourcePath;
  disabled?: boolean;
}) {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  const moduleFilePathParts = moduleFilePath.split("/"); // TODO: create a function to split module file paths properly
  const modulePathParts = Internal.splitModulePath(modulePath);
  const { navigate } = useNavigation();
  return (
    <div title={path} className="w-full">
      <button
        disabled={disabled}
        className="inline-block text-left truncate"
        onClick={() => {
          navigate(moduleFilePath);
        }}
      >
        {moduleFilePathParts.map((part, i) => (
          <Fragment key={`${part}-${i}`}>
            {i === 0 && <span className="text-muted">/</span>}
            <span
              className={classNames({
                "text-muted": !(
                  modulePathParts.length === 0 &&
                  i === moduleFilePathParts.length - 1
                ),
              })}
            >
              {prettifyFilename(part)}
            </span>
            {i > 0 && i < moduleFilePathParts.length - 1 && (
              <span className="text-muted">/</span>
            )}
          </Fragment>
        ))}
      </button>
      <button
        disabled={disabled}
        className="inline-block text-left truncate"
        onClick={() => {
          navigate(
            Internal.joinModuleFilePathAndModulePath(
              moduleFilePath,
              modulePath,
            ),
          );
        }}
      >
        {modulePathParts.map((part, i) => (
          <Fragment key={`${part}-${i}`}>
            <span className="text-muted">/</span>
            <span
              className={classNames({
                "text-muted": i === modulePathParts.length - 2,
              })}
            >
              {prettifyFilename(part)}
            </span>
          </Fragment>
        ))}
      </button>
    </div>
  );
}

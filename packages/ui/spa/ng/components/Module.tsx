import { Internal, ModulePath, SourcePath } from "@valbuild/core";
import {
  useAddPatch,
  useSchemaAtPath,
  useShallowSourceAtPath,
} from "../ValProvider";
import { FieldSchemaError } from "./FieldSchemaError";
import { FieldLoading } from "./FieldLoading";
import { FieldNotFound } from "./FieldNotFound";
import { AnyField } from "./AnyField";
import { prettifyFilename } from "../../utils/prettifyFilename";
import { Fragment, useState } from "react";
import { ChevronRight, Edit } from "lucide-react";
import { useNavigation } from "../../components/ValRouter";
import { array } from "@valbuild/core/fp";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";

export function Module({ path }: { path: SourcePath }) {
  const schemaAtPath = useSchemaAtPath(path);
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  const maybeParentPath = Internal.joinModuleFilePathAndModulePath(
    moduleFilePath,
    Internal.splitModulePath(modulePath).slice(0, -1).join(".") as ModulePath,
  );
  const parentSchemaAtPath = useSchemaAtPath(maybeParentPath);
  const [editKeyMode, setEditKeyMode] = useState(false);
  const { navigate } = useNavigation();
  if (schemaAtPath.status === "loading") {
    return <FieldLoading path={path} type="module" />;
  }
  if (schemaAtPath.status === "error") {
    return (
      <FieldSchemaError path={path} error={schemaAtPath.error} type="module" />
    );
  }
  if (schemaAtPath.status === "not-found") {
    return <FieldNotFound path={path} type="module" />;
  }
  if (parentSchemaAtPath.status === "loading") {
    return <FieldLoading path={maybeParentPath} type="module" />;
  }
  if (parentSchemaAtPath.status === "error") {
    return (
      <FieldSchemaError
        path={maybeParentPath}
        error={parentSchemaAtPath.error}
        type="module"
      />
    );
  }
  if (parentSchemaAtPath.status === "not-found") {
    return <FieldNotFound path={maybeParentPath} type="module" />;
  }

  const schema = schemaAtPath.data;
  const isParentRecord =
    maybeParentPath !== path && parentSchemaAtPath.data.type === "record";

  const parts = splitIntoInitAndLastParts(path);
  const init = parts.slice(0, -1);
  const last = parts[parts.length - 1];
  return (
    <div className="flex flex-col gap-6 py-10">
      <div className="flex flex-col gap-2 text-left">
        {parts.length > 1 && (
          <div className="inline-flex items-center text-sm text-text-quartenary">
            {init.map((part, i) => {
              if (i < init.length - 1) {
                return (
                  <Fragment key={i}>
                    <button
                      onClick={() => {
                        navigate(part.sourcePath);
                      }}
                    >
                      {part.text}
                    </button>
                    <span>
                      <ChevronRight size={16} />
                    </span>
                  </Fragment>
                );
              }
              return (
                <button
                  onClick={() => {
                    navigate(part.sourcePath);
                  }}
                  key={i}
                >
                  {part.text}
                </button>
              );
            })}
          </div>
        )}
        <div>
          <div className="flex items-center h-12 gap-2 text-xl">
            {!editKeyMode && (
              <>
                <span>{last.text}</span>
                {isParentRecord && (
                  <button
                    onClick={() => {
                      setEditKeyMode(true);
                    }}
                  >
                    <Edit />
                  </button>
                )}
              </>
            )}
            {editKeyMode && (
              <RecordKeyForm
                defaultValue={last.text}
                path={path}
                parentPath={maybeParentPath}
                onComplete={(newPath) => {
                  navigate(newPath, { replace: true });
                  setEditKeyMode(false);
                }}
              />
            )}
          </div>
        </div>
      </div>
      <AnyField key={path} path={path} schema={schema} />
    </div>
  );
}

function RecordKeyForm({
  defaultValue,
  path,
  parentPath,
  onComplete,
}: {
  defaultValue: string;
  path: SourcePath;
  parentPath: SourcePath;
  onComplete: (newPath: SourcePath) => void;
}) {
  const { addPatch } = useAddPatch(path);
  const [moduleFilePath, parentModulePath] =
    Internal.splitModuleFilePathAndModulePath(parentPath);
  const shallowParentSource = useShallowSourceAtPath(parentPath, "record");
  const [key, setKey] = useState(defaultValue); // cannot change - right?
  const parentPatchPath = Internal.createPatchPath(parentModulePath);

  if (
    !("data" in shallowParentSource) ||
    shallowParentSource.data === undefined ||
    shallowParentSource.data === null
  ) {
    // An actual error message should be shown above
    console.error("Parent source not found", shallowParentSource, { path });
    return null;
  }
  const disabled =
    key === defaultValue || key === "" || key in shallowParentSource.data;
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(ev) => {
        ev.preventDefault();
        onComplete(
          Internal.joinModuleFilePathAndModulePath(
            moduleFilePath,
            Internal.patchPathToModulePath(parentPatchPath.concat(key)),
          ),
        );
        addPatch([
          {
            op: "move",
            from: parentPatchPath.concat(
              defaultValue,
            ) as array.NonEmptyArray<string>,
            path: parentPatchPath.concat(key) as array.NonEmptyArray<string>,
          },
        ]);
      }}
    >
      <Input
        className="inline-block max-w-[320px]"
        type="text"
        value={key}
        onChange={(ev) => {
          setKey(ev.target.value);
        }}
      />
      <Button disabled={disabled}>Save</Button>
    </form>
  );
}

function splitIntoInitAndLastParts(
  path: SourcePath,
): { text: string; sourcePath: SourcePath }[] {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  const moduleFilePathParts = Internal.splitModuleFilePath(moduleFilePath).map(
    (part) => {
      return {
        text: prettifyFilename(part),
        sourcePath: moduleFilePath as unknown as SourcePath,
      };
    },
  );
  if (!modulePath) {
    return moduleFilePathParts;
  }
  const splittedModulePath = Internal.splitModulePath(modulePath);
  const modulePathParts = splittedModulePath.map((part, i) => {
    return {
      text: part,
      sourcePath: Internal.joinModuleFilePathAndModulePath(
        moduleFilePath,
        splittedModulePath.slice(0, i + 1).join(".") as ModulePath,
      ),
    };
  });
  return moduleFilePathParts.concat(modulePathParts);
}

import { SourcePath, Internal, ModuleFilePath } from "@valbuild/core";
import { array } from "@valbuild/core/fp";
import { Patch } from "@valbuild/core/patch";
import { Button } from "./designSystem/button";
import { Input } from "./designSystem/input";
import { useState } from "react";
import { useAddPatch, useShallowSourceAtPath } from "./ValProvider";

export function RenameRecordKeyForm({
  parentPath,
  path,
  defaultValue,
  refs,
  onCancel,
  onSubmit,
}: {
  parentPath: SourcePath | ModuleFilePath;
  path: SourcePath | ModuleFilePath;
  defaultValue: string;
  refs: SourcePath[];
  onSubmit: (sourcePath: SourcePath) => void;
  onCancel: () => void;
}) {
  const [moduleFilePath, parentModulePath] =
    Internal.splitModuleFilePathAndModulePath(parentPath);
  const { addPatch, addModuleFilePatch } = useAddPatch(path);
  const [key, setKey] = useState(defaultValue); // cannot change - right?
  const parentPatchPath = Internal.createPatchPath(parentModulePath);
  const parentSource = useShallowSourceAtPath(parentPath, "record");
  const disabled =
    parentSource.status === "success" &&
    parentSource.data !== null &&
    (key === defaultValue || key === "" || key in parentSource.data);

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(ev) => {
        ev.preventDefault();
        const patchOps: Patch = [
          {
            op: "move",
            from: parentPatchPath.concat(
              defaultValue,
            ) as array.NonEmptyArray<string>,
            path: parentPatchPath.concat(key) as array.NonEmptyArray<string>,
          },
        ];
        addPatch(patchOps, "record");
        for (const ref of refs) {
          const [refModuleFilePath, refModulePath] =
            Internal.splitModuleFilePathAndModulePath(ref);
          const refPatchPath = Internal.createPatchPath(refModulePath);
          addModuleFilePatch(
            refModuleFilePath,
            [
              {
                op: "replace",
                path: refPatchPath,
                value: key,
              },
            ],
            "record",
          );
        }
        onSubmit(
          Internal.joinModuleFilePathAndModulePath(
            moduleFilePath,
            Internal.patchPathToModulePath(parentPatchPath.concat(key)),
          ),
        );
      }}
    >
      <Input
        type="text"
        value={key}
        onChange={(ev) => {
          setKey(ev.target.value);
        }}
      />
      <div className="flex gap-2 items-center">
        <Button disabled={disabled} variant="outline" type="submit">
          Update
        </Button>
        <Button
          variant={"ghost"}
          type="reset"
          onClick={() => {
            onCancel();
            setKey(defaultValue);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

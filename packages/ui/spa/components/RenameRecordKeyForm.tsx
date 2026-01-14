import { SourcePath, ModuleFilePath } from "@valbuild/core";
import { Button } from "./designSystem/button";
import { Input } from "./designSystem/input";
import { useState } from "react";

export function RenameRecordKeyForm({
  existingKeys,
  defaultValue,
  onCancel,
  onSubmit,
}: {
  parentPath: SourcePath | ModuleFilePath;
  defaultValue: string;
  existingKeys: string[];
  onSubmit: (key: string) => void;
  onCancel: () => void;
}) {
  const [key, setKey] = useState(defaultValue);
  const alreadyExists = existingKeys.includes(key) && key !== defaultValue;
  const disabled = key === defaultValue || key === "" || alreadyExists;

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(ev) => {
        ev.preventDefault();
        onSubmit(key);
      }}
    >
      <Input
        type="text"
        value={key}
        onChange={(ev) => {
          setKey(ev.target.value);
        }}
      />
      {alreadyExists && (
        <p className="text-sm text-fg-error-secondary">
          A record with this key already exists
        </p>
      )}
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

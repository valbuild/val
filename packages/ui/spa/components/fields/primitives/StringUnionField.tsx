import { Patch } from "@valbuild/core/patch";
import { useState, useEffect } from "react";
import { OnSubmit, SubmitStatus } from "../SubmitStatus";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { FieldContainer } from "../FieldContainer";

export function StringUnionField({
  onSubmit,
  options,
  defaultValue,
}: {
  path: string;
  options: string[];
  onSubmit?: OnSubmit;
  defaultValue?: string | null;
}) {
  const [value, setValue] = useState<string>();
  useEffect(() => {
    if (defaultValue !== null && defaultValue !== undefined) {
      setValue(defaultValue);
    }
  }, [defaultValue]);
  const [loading, setLoading] = useState(false);
  return (
    <FieldContainer>
      <div className="flex items-center justify-between">
        <Select
          value={value}
          onValueChange={(value) => {
            setValue(value);
            if (onSubmit) {
              setLoading(true);
              onSubmit((path) =>
                Promise.resolve(createStringUnionPatch(path, value)),
              ).finally(() => {
                setLoading(false);
              });
            }
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {options.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <SubmitStatus submitStatus={loading ? "loading" : "idle"} />
      </div>
    </FieldContainer>
  );
}

export function createStringUnionPatch(
  path: string[],
  value: string | null,
): Patch {
  return [
    {
      value,
      op: "replace",
      path,
    },
  ];
}

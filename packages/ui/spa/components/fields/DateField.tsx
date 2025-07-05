import { SourcePath } from "@valbuild/core";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useState, useEffect } from "react";
import { Button } from "../designSystem/button";
import { Calendar } from "../designSystem/calendar";
import classNames from "classnames";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { FieldSourceError } from "../../components/FieldSourceError";
import {
  useSchemaAtPath,
  useShallowSourceAtPath,
  useAddPatch,
  useValPortal,
} from "../ValProvider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../designSystem/popover";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { ValidationErrors } from "../../components/ValidationError";

export function DateField({ path }: { path: SourcePath }) {
  const type = "date";
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
  const { patchPath, addPatch } = useAddPatch(path);
  const [currentValue, setCurrentValue] = useState<Date | null>(null);
  const [isPopoverOpen, setPopoverOpen] = useState(false);
  const portalContainer = useValPortal();
  useEffect(() => {
    if ("data" in sourceAtPath && sourceAtPath.data !== undefined) {
      if (sourceAtPath.data === null) {
        setCurrentValue(sourceAtPath.data);
      } else {
        try {
          const date = new Date(sourceAtPath.data);
          setCurrentValue(date);
        } catch (e) {
          console.error("Cannot parse invalid date:", sourceAtPath.data);
        }
      }
    }
  }, ["data" in sourceAtPath && sourceAtPath.data]);

  if (schemaAtPath.status === "error") {
    return (
      <FieldSchemaError path={path} error={schemaAtPath.error} type={type} />
    );
  }
  if (sourceAtPath.status === "error") {
    return (
      <FieldSourceError
        path={path}
        error={sourceAtPath.error}
        schema={schemaAtPath}
      />
    );
  }
  if (
    sourceAtPath.status == "not-found" ||
    schemaAtPath.status === "not-found"
  ) {
    return <FieldNotFound path={path} type={type} />;
  }
  if (schemaAtPath.status === "loading") {
    return <FieldLoading path={path} type={type} />;
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <FieldLoading path={path} type={type} />;
  }
  if (schemaAtPath.data.type !== type) {
    return (
      <FieldSchemaMismatchError
        path={path}
        expectedType={type}
        actualType={schemaAtPath.data.type}
      />
    );
  }

  const schema = schemaAtPath.data;
  return (
    <div id={path}>
      <ValidationErrors path={path} />
      <Popover
        open={isPopoverOpen}
        onOpenChange={(next) => {
          setPopoverOpen(next);
        }}
      >
        <PopoverTrigger
          asChild
          onClick={() => {
            setPopoverOpen(true);
          }}
        >
          <Button
            variant={"outline"}
            className={classNames(
              "w-[280px] justify-start text-left font-normal",
            )}
          >
            <CalendarIcon className="w-4 h-4 mr-2" />
            {currentValue ? (
              format(currentValue, "PPP")
            ) : (
              <span>Pick a date</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" container={portalContainer}>
          <Calendar
            mode="single"
            captionLayout="dropdown-buttons"
            defaultMonth={currentValue ?? undefined}
            weekStartsOn={1}
            fromDate={
              schema.options?.from ? new Date(schema.options.from) : undefined
            }
            toDate={
              schema.options?.to ? new Date(schema.options.to) : undefined
            }
            selected={currentValue || undefined}
            onSelect={(date) => {
              if (date) {
                setCurrentValue(date);
                addPatch(
                  [
                    {
                      op: "replace",
                      value: date.toISOString().slice(0, 10),
                      path: patchPath,
                    },
                  ],
                  schema.type,
                );
                setPopoverOpen(false);
              }
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function DatePreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "date");
  if (sourceAtPath.status === "error") {
    return <FieldSourceError path={path} error={sourceAtPath.error} />;
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  return (
    <div className="truncate">
      {new Date(sourceAtPath.data).toLocaleString()}
    </div>
  );
}

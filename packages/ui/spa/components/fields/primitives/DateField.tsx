import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@radix-ui/react-popover";
import { SourcePath, SerializedDateSchema } from "@valbuild/core";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "../../../lib/utils";
import { OnSubmit } from "../../SubmitStatus";
import { Button } from "../../ui/button";
import { Calendar } from "../../ui/calendar";

export function DateField({
  defaultValue,
  schema,
  onSubmit,
}: {
  path: SourcePath;
  defaultValue?: string | null;
  schema: SerializedDateSchema;
  onSubmit?: OnSubmit;
}) {
  const [date, setDate] = useState<Date>();
  useEffect(() => {
    try {
      if (defaultValue) {
        const date = new Date(defaultValue);
        if (!isNaN(date.getTime())) {
          setDate(date);
        }
      }
    } catch (err) {
      console.error("Invalid date", defaultValue);
    }
  }, [defaultValue]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={"outline"}
          className={cn(
            "w-[280px] justify-start text-left font-normal",
            !date && "text-muted-foreground"
          )}
        >
          <CalendarIcon className="w-4 h-4 mr-2" />
          {date ? format(date, "PPP") : <span>Pick a date</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          captionLayout="dropdown-buttons"
          defaultMonth={date}
          fromDate={
            schema.options?.from ? new Date(schema.options.from) : undefined
          }
          toDate={schema.options?.to ? new Date(schema.options.to) : undefined}
          selected={date}
          onSelect={(date) => {
            if (onSubmit) {
              setDate(date);
              onSubmit(async (path) => {
                if (!date) {
                  return [
                    {
                      op: "replace",
                      path,
                      value: null,
                    },
                  ];
                }
                return [
                  {
                    op: "replace",
                    path,
                    value: format(date, "yyyy-MM-dd"),
                  },
                ];
              }).catch((err) => {
                console.error("Could not save date", err);
                setDate(undefined);
              });
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

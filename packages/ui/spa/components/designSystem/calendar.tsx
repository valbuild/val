import * as React from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "./cn";
import { Button, buttonVariants } from "./button";
import * as Select from "@radix-ui/react-select";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  captionLayout,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  const hasRange = props.fromDate && props.toDate;
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        caption: "flex flex-row justify-center pt-1 relative items-center",
        caption_dropdowns: "flex flex-row space-x-2",
        caption_label: `text-sm font-medium ${hasRange ? "hidden" : ""}`,
        nav: "space-x-1 flex items-center",
        dropdown_month:
          "flex flex-row text-accent justify-between text-[0.8rem]",
        dropdown_year:
          "flex flex-row text-accent justify-between text-[0.8rem]",
        dropdown:
          "bg-transparent border-solid rounded-md border-2 border-secondary",
        nav_button: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100",
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse space-y-1",
        head_row: "flex",
        head_cell:
          "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
        row: "flex w-full mt-2",
        cell: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal aria-selected:opacity-100",
        ),
        day_range_end: "day-range-end",
        day_selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:text-primary-foreground",
        day_today: "bg-accent text-accent-foreground",
        day_outside:
          "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
        day_disabled: "text-muted-foreground opacity-50",
        day_range_middle:
          "aria-selected:bg-accent aria-selected:text-accent-foreground",
        ...classNames,
      }}
      components={{
        IconLeft: () => <ChevronLeft className="w-4 h-4" />,
        IconRight: () => <ChevronRight className="w-4 h-4" />,
        Dropdown: ({ caption, children, value, onChange }) => {
          const handleValueChange = (newValue: string) => {
            if (onChange) {
              const event = { target: { value: newValue } };
              onChange(event as React.ChangeEvent<HTMLSelectElement>);
            }
          };

          return (
            <div className="flex flex-row space-x-2">
              <Select.Root
                onValueChange={handleValueChange}
                value={String(value)}
              >
                <Select.Trigger asChild>
                  <Button variant="ghost" size="sm">
                    {caption}
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                </Select.Trigger>
                <Select.Content className="z-50 p-1 rounded-md bg-bg-secondary_alt text-text-secondary">
                  <Select.Viewport className="overflow-y-auto pr-4 pb-4 max-h-48 rounded-md shadow-lg bg-bg-tertiary text-fg-tertiary">
                    {React.Children.map(children, (child) => {
                      if (React.isValidElement(child)) {
                        const { value, children } = child.props;
                        return (
                          <Select.Item
                            key={value}
                            value={String(value)}
                            className="p-2 rounded-md cursor-pointer hover:bg-bg-secondary-hover hover:text-fg-secondary"
                          >
                            <Select.ItemText>{children}</Select.ItemText>
                          </Select.Item>
                        );
                      }
                      return null;
                    })}
                  </Select.Viewport>
                </Select.Content>
              </Select.Root>
            </div>
          );
        },
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };

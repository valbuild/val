import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogProps } from "./dialog";

import { cn } from "./cn";

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-md bg-bg-primary text-fg-primary",
      className,
    )}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

type CommandDialogProps = DialogProps & {
  container?: HTMLElement | null;
  hideClose?: boolean;
  contentClassName?: string;
};

const CommandDialog = ({
  children,
  container,
  hideClose,
  contentClassName,
  ...props
}: CommandDialogProps) => {
  return (
    <Dialog {...props}>
      <DialogContent
        container={container}
        hideClose={hideClose}
        className={cn("p-0 overflow-hidden shadow-lg", contentClassName)}
      >
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-secondary [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
};

/**
 * The row a search input sits in, with its magnifier: what `CommandInput`
 * draws, for a list that filters itself (`WindowedOptionList`) and so has no
 * `cmdk` input to put in it.
 */
const SearchInputRow = ({ children }: { children: React.ReactNode }) => (
  // The ring goes on the ROW, not on the input. The input starts after the
  // search icon and stops short of the row's padding - measured in the router
  // dropdown, a 890px popover with the input running 194..1034 - so a ring on
  // it is a rectangle floating inside the box with a gap down each side, which
  // is not what a focused text field looks like. On the row it runs the full
  // width of the box, which is where the eye expects the edge to be.
  //
  // `ring-inset` because there is nothing outside the row either: a popover
  // (`p-0` + `overflow-hidden`) clips an outset ring away against its top edge,
  // and the inline search box (`overflow-visible`) draws it on top of its own
  // border. `rounded-t-[inherit]` so the two top corners follow whatever radius
  // the box has - `rounded-md` in a popover, `rounded-lg` in the search box.
  //
  // `has-[:focus-visible]` and not `focus-within`: the row must light up for
  // the keyboard, and stay dark when the input is focused by a click or
  // programmatically - which is the same rule the input itself had.
  <div
    className="flex items-center px-3 rounded-t-[inherit] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-border-focus"
    cmdk-input-wrapper=""
  >
    <Search className="w-4 h-4 mr-2 opacity-50 shrink-0" />
    {children}
  </div>
);

/**
 * The search input's own classes, inside a {@link SearchInputRow}. 16px on a
 * touch screen (`touch:text-base`): iOS zooms the page into a focused field
 * under 16px, and this one is focused the moment its list opens.
 */
const searchInputClassName = cn(
  "flex h-11 w-full rounded-sm py-3 text-sm touch:text-base",
  "placeholder:text-fg-secondary",
  "bg-transparent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
);

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <SearchInputRow>
    <CommandPrimitive.Input
      ref={ref}
      className={cn(searchInputClassName, className)}
      {...props}
    />
  </SearchInputRow>
));

CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn("max-h-[300px] overflow-y-auto overflow-x-hidden", className)}
    {...props}
  />
));

CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className="py-6 text-sm text-center"
    {...props}
  />
));

CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      "overflow-hidden p-1 text-fg-primary [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-secondary",
      className,
    )}
    {...props}
  />
));

CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 h-px bg-border-primary opacity-50", className)}
    {...props}
  />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

/** A `CommandItem`'s classes, for an option of a list `cmdk` does not draw. */
const commandItemClassName =
  "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none aria-selected:bg-bg-primary-hover aria-selected:text-fg-primary data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50";

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(commandItemClassName, className)}
    {...props}
  />
));

CommandItem.displayName = CommandPrimitive.Item.displayName;

const CommandShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        "ml-auto text-xs tracking-widest text-fg-secondary",
        className,
      )}
      {...props}
    />
  );
};
CommandShortcut.displayName = "CommandShortcut";

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
  SearchInputRow,
  searchInputClassName,
  commandItemClassName,
};

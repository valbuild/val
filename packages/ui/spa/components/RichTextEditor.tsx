import {
  Remirror,
  useRemirror,
  EditorComponent,
  useActive,
  useChainedCommands,
  useAttrs,
  useCurrentSelection,
  useRemirrorContext,
  useHelpers,
} from "@remirror/react";
import classNames from "classnames";
import {
  Bold,
  Strikethrough,
  Italic,
  Link,
  List,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  ListOrdered,
  Image,
  Unlink,
  Check,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./designSystem/dropdown-menu";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "./designSystem/popover";
import { Button } from "./designSystem/button";
import { Input } from "./designSystem/input";
import { Internal, SerializedRichTextOptions } from "@valbuild/core";
import { readImage } from "../utils/readImage";
import { RouteSelector } from "./fields/RouteField";
import { BoldExtension } from "@remirror/extension-bold";
import { ItalicExtension } from "@remirror/extension-italic";
import { StrikeExtension } from "@remirror/extension-strike";
import { ImageExtension } from "@remirror/extension-image";
import { DropCursorExtension } from "@remirror/extension-drop-cursor";
import { HeadingExtension } from "@remirror/extension-heading";
import {
  BulletListExtension,
  OrderedListExtension,
} from "@remirror/extension-list";
import { LinkExtension } from "@remirror/extension-link";
import { HardBreakExtension } from "@remirror/extension-hard-break";
import {
  RemirrorJSON,
  RemirrorManager,
  AnyExtension,
  EditorState,
  RemirrorEventListenerProps,
} from "@remirror/core";
import { useValPortal } from "./ValPortalProvider";
import { useRoutesWithModulePaths } from "./useRoutesOf";

const allExtensions = () => {
  const extensions = [
    new BoldExtension({}),
    new ItalicExtension(),
    new StrikeExtension(),
    new ImageExtension({
      enableResizing: false,
    }),
    new DropCursorExtension({}),
    new HeadingExtension({
      levels: [1, 2, 3, 4, 5, 6],
      defaultLevel: 1,
    }),
    new BulletListExtension({}),
    new OrderedListExtension(),
    new LinkExtension({ autoLink: true }),
    new HardBreakExtension(),
  ] as const;
  return extensions.slice();
};

export function useRichTextEditor(defaultValue?: RemirrorJSON) {
  const { manager, state, setState } = useRemirror({
    extensions: allExtensions, // TODO: filter on options?
    content: defaultValue,
    selection: "start",
  });
  return { manager, state, setState };
}

export function RichTextEditor<E extends AnyExtension>({
  initialContent,
  state,
  manager,
  options,
  onChange,
  onFocus,
  debug,
  disabled,
  autoFocus,
}: {
  initialContent?: Readonly<EditorState>;
  state?: Readonly<EditorState>;
  manager: RemirrorManager<E>;
  options?: SerializedRichTextOptions;
  onChange?: (value: RemirrorEventListenerProps<E>) => void;
  onFocus?: (focused: boolean) => void;
  debug?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const hasOptions =
    options && Object.entries(options).some(([, value]) => value);
  const [showToolbar, setShowToolbar] = useState(hasOptions);
  const remirrorClassNames = useMemo(() => {
    return [
      classNames(
        "p-4 outline-none focus:outline-none appearance-none bg-bg-primary rounded-b-md",
      ),
    ];
  }, [showToolbar]);

  return (
    <div
      autoFocus={autoFocus}
      onFocus={() => {
        if (onFocus) {
          onFocus(true);
        }
      }}
      onBlur={() => {
        if (onFocus) {
          onFocus(false);
        }
      }}
      className={classNames(
        "relative text-base m-1 val-rich-text-editor focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 border border-input rounded-md",
      )}
    >
      <Remirror
        manager={manager}
        initialContent={initialContent}
        state={state}
        classNames={remirrorClassNames}
        onChange={onChange}
        editable={!disabled}
      >
        <Toolbar
          hasOptions={hasOptions}
          options={options}
          debug={debug}
          setShowToolbar={setShowToolbar}
        />
        <EditorComponent />
      </Remirror>
    </div>
  );
}

const Toolbar = ({
  options,
  hasOptions,
  debug,
  setShowToolbar,
}: {
  options?: SerializedRichTextOptions;
  hasOptions?: boolean;
  debug?: boolean;
  setShowToolbar: (showToolbar: boolean) => void;
}) => {
  const chain = useChainedCommands();
  const active = useActive<ReturnType<typeof allExtensions>[number]>();
  const showToolbar =
    hasOptions ||
    active.heading() ||
    active.image() ||
    active.link() ||
    active.bulletList() ||
    active.orderedList() ||
    active.bold() ||
    active.italic() ||
    active.strike();

  useEffect(() => {
    setShowToolbar(showToolbar);
  }, [showToolbar]);

  const dropdownContainerRef = useRef<HTMLDivElement>(null);

  return (
    <div>
      <div className="h-0" ref={dropdownContainerRef}></div>
      <div
        className={classNames(
          "sticky top-0 flex flex-col py-1 z-[40] divide-y rounded-md rounded-b-none border-b border-border-primary",
          {
            hidden: !showToolbar,
          },
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex flex-row items-center justify-start px-2 py-1 gap-x-1">
            {(options?.block?.h1 ||
              options?.block?.h2 ||
              options?.block?.h3 ||
              options?.block?.h4 ||
              options?.block?.h5 ||
              options?.block?.h6 ||
              active.heading()) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="xs" className="min-w-[3.5rem]">
                    {active.heading({ level: 1 }) && <Heading1 size={16} />}
                    {active.heading({ level: 2 }) && <Heading2 size={16} />}
                    {active.heading({ level: 3 }) && <Heading3 size={16} />}
                    {active.heading({ level: 4 }) && <Heading4 size={16} />}
                    {active.heading({ level: 5 }) && <Heading5 size={16} />}
                    {active.heading({ level: 6 }) && <Heading6 size={16} />}
                    {!active.heading() && "Normal"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent container={dropdownContainerRef.current}>
                  <DropdownMenuItem
                    onClick={() => {
                      chain.setBlockNodeType("paragraph").focus().run();
                    }}
                  >
                    Normal
                    {/* <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut> */}
                  </DropdownMenuItem>
                  {options?.block?.h1 && (
                    <DropdownMenuItem
                      onClick={() => {
                        chain
                          .setBlockNodeType("heading", { level: 1 })
                          .focus()
                          .run();
                      }}
                    >
                      <Heading1 size={16} />
                    </DropdownMenuItem>
                  )}
                  {options?.block?.h2 && (
                    <DropdownMenuItem
                      onClick={() => {
                        chain
                          .setBlockNodeType("heading", { level: 2 })
                          .focus()
                          .run();
                      }}
                    >
                      <Heading2 size={16} />
                    </DropdownMenuItem>
                  )}
                  {options?.block?.h3 && (
                    <DropdownMenuItem
                      onClick={() => {
                        chain
                          .setBlockNodeType("heading", { level: 3 })
                          .focus()
                          .run();
                      }}
                    >
                      <Heading3 size={16} />
                    </DropdownMenuItem>
                  )}
                  {options?.block?.h4 && (
                    <DropdownMenuItem
                      onClick={() => {
                        chain
                          .setBlockNodeType("heading", { level: 4 })
                          .focus()
                          .run();
                      }}
                    >
                      <Heading4 size={16} />
                    </DropdownMenuItem>
                  )}
                  {options?.block?.h5 && (
                    <DropdownMenuItem
                      onClick={() => {
                        chain
                          .setBlockNodeType("heading", { level: 5 })
                          .focus()
                          .run();
                      }}
                    >
                      <Heading5 size={16} />
                    </DropdownMenuItem>
                  )}
                  {options?.block?.h6 && (
                    <DropdownMenuItem
                      onClick={() => {
                        chain
                          .setBlockNodeType("heading", { level: 6 })
                          .focus()
                          .run();
                      }}
                    >
                      <Heading6 size={16} />
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {(options?.style?.bold || active.bold()) && (
              <ToolbarButton
                icon={<Bold size={16} />}
                stroke={3}
                isOption={options?.style?.bold}
                isActive={options?.style?.bold || active.bold()}
                onToggle={() => chain.toggleBold().focus().run()}
              />
            )}
            {(options?.style?.lineThrough || active.strike()) && (
              <ToolbarButton
                icon={<Strikethrough size={16} />}
                stroke={3}
                isOption={options?.style?.lineThrough}
                isActive={options?.style?.lineThrough || active.strike()}
                onToggle={() => chain.toggleStrike().focus().run()}
              />
            )}
            {(options?.style?.italic || active.italic()) && (
              <ToolbarButton
                icon={<Italic size={16} />}
                stroke={3}
                isOption={options?.style?.italic}
                isActive={options?.style?.italic || active.italic()}
                onToggle={() => chain.toggleItalic().focus().run()}
              />
            )}
            {(options?.block?.ul || active.bulletList()) && (
              <ToolbarButton
                icon={<List size={16} />}
                stroke={3}
                isActive={options?.block?.ul || active.bulletList()}
                onToggle={() => chain.toggleBulletList().focus().run()}
              />
            )}
            {(options?.block?.ol || active.orderedList()) && (
              <ToolbarButton
                icon={<ListOrdered size={16} />}
                stroke={3}
                isActive={options?.block?.ol || active.orderedList()}
                onToggle={() => chain.toggleOrderedList().focus().run()}
              />
            )}
            {(options?.inline?.a || active.link()) && (
              <LinkPopover options={options} />
            )}
            {(options?.inline?.img || active.image()) && (
              <>
                <input
                  hidden
                  id="val-toolbar-image-select"
                  accept="image/*"
                  type="file"
                  onChange={(ev) => {
                    readImage(ev).then((res) => {
                      chain
                        .insertImage({
                          src: res.src,
                          width: res.width,
                          height: res.height,
                          fileName:
                            Internal.createFilename(
                              res.src,
                              res.filename ?? null,
                              {
                                width: res.width,
                                height: res.height,
                                mimeType: res.mimeType,
                              },
                              res.fileHash,
                            ) ?? undefined,
                        })
                        .focus()
                        .run();
                      // reset the input value to allow re-uploading the same file
                      ev.target.value = "";
                    });
                  }}
                />
                <Button variant="ghost" size="icon-sm" asChild>
                  <label htmlFor="val-toolbar-image-select">
                    <Image
                      size={16}
                      className={classNames({
                        "text-accent stroke-[3px]": active.image(),
                      })}
                    />
                  </label>
                </Button>
              </>
            )}
            {debug && (
              <Button
                variant="ghost"
                size="icon-sm"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chain.insertHardBreak().run()}
              >
                Br
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

function LinkPopover({ options }: { options?: SerializedRichTextOptions }) {
  const portalContainer = useValPortal();
  const chain = useChainedCommands();
  const activeLink = useAttrs<LinkExtension>().link();
  const { empty, to, from } = useCurrentSelection();

  // Get all routes with their module paths for route selection
  const routesWithModulePaths = useRoutesWithModulePaths();

  const [open, setOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkHref, setLinkHref] = useState("");

  const { getTextBetween } = useHelpers();

  // Detect if inline.a is a route schema
  // When inline.a is true, default to route
  // When inline.a is an object with type: "route", it's a route
  // When inline.a is an object with type: "string", it's a string
  const isRouteLink =
    options?.inline?.a === true ||
    (typeof options?.inline?.a === "object" &&
      "type" in options.inline.a &&
      options.inline.a.type === "route");

  // Extract patterns from schema if it's a route
  const routeSchema =
    isRouteLink &&
    options?.inline?.a &&
    typeof options.inline.a === "object" &&
    "type" in options.inline.a &&
    options.inline.a.type === "route"
      ? options.inline.a
      : undefined;
  const includePattern = routeSchema?.options?.include
    ? new RegExp(
        routeSchema.options.include.source,
        routeSchema.options.include.flags,
      )
    : undefined;
  const excludePattern = routeSchema?.options?.exclude
    ? new RegExp(
        routeSchema.options.exclude.source,
        routeSchema.options.exclude.flags,
      )
    : undefined;

  const { view } = useRemirrorContext();
  // Handle opening the popover
  const handleOpenPopover = useCallback(() => {
    // If cursor is on a link, always select the entire link first
    const hasExistingLink = activeLink !== undefined;
    if (hasExistingLink) {
      // Select the entire link mark, whether or not there's already a selection
      chain.selectMark("link").run();

      // Get the href from activeLink

      // Small delay to let the selection update, then get the selected text
      setTimeout(() => {
        const selection = view.state.selection;
        const selectedText = getTextBetween(selection.from, selection.to);
        setLinkText(selectedText);
        setLinkHref(activeLink.href as string);
        setOpen(true);
      }, 10);
    } else {
      setOpen(true);
    }
  }, [activeLink, chain, view, getTextBetween]);

  useEffect(() => {
    const handleDoubleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const linkElement = target.tagName === "A" ? target : target.closest("a");

      if (linkElement) {
        event.preventDefault();
        event.stopPropagation();
        const pos = view.posAtDOM(linkElement, 0);
        chain.selectText(pos).selectMark("link").run();
        setLinkText(linkElement.textContent || "");
        setLinkHref(linkElement.getAttribute("href") || "");
        setTimeout(() => setOpen(true), 10);
      }
    };

    const editorElement = view.dom;
    editorElement.addEventListener("dblclick", handleDoubleClick);
    return () => {
      editorElement.removeEventListener("dblclick", handleDoubleClick);
    };
  }, [view, chain]);

  const handleSubmit = () => {
    if (!linkText.trim() || !linkHref.trim()) {
      return;
    }

    if (empty) {
      chain
        .insertText(linkText)
        .selectText({ from, to: to + linkText.length })
        .updateLink({ href: linkHref })
        .focus()
        .run();
    } else {
      chain
        .replaceText({ content: linkText })
        .updateLink({ href: linkHref })
        .focus()
        .run();
    }

    setOpen(false);
    setLinkText("");
    setLinkHref("");
  };

  const handleRemove = () => {
    chain.removeLink().focus().run();
    setOpen(false);
    setLinkText("");
    setLinkHref("");
  };

  const handleCancel = () => {
    setOpen(false);
    setLinkText("");
    setLinkHref("");
  };

  const isSubmitDisabled = !linkText.trim() || !linkHref.trim();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={classNames({
            "text-accent stroke-[3px]":
              !!options?.inline?.a || activeLink !== undefined,
            "bg-bg-primary-hover": activeLink !== undefined,
          })}
          onClick={handleOpenPopover}
        >
          <Link size={16} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" container={portalContainer}>
        <div className="relative">
          <button
            className="absolute right-0 top-0 p-1 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            onClick={handleCancel}
            aria-label="Close"
          >
            <X size={16} />
          </button>
          <div className="space-y-3 pt-6">
            <div className="space-y-2">
              <label className="text-sm font-medium">Link Text</label>
              <Input
                placeholder="Enter link text"
                value={linkText}
                onChange={(e) => setLinkText(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {isRouteLink ? "Route" : "URL"}
              </label>
              {isRouteLink ? (
                <RouteSelector
                  routes={routesWithModulePaths}
                  value={linkHref}
                  onChange={(route) => setLinkHref(route)}
                  includePattern={includePattern}
                  excludePattern={excludePattern}
                  placeholder="Select route..."
                  portalContainer={portalContainer}
                />
              ) : (
                <Input
                  placeholder="https://"
                  value={linkHref}
                  onChange={(e) => setLinkHref(e.target.value)}
                />
              )}
            </div>
            <div className="flex justify-between items-center gap-2">
              <div className="flex gap-2">
                {!empty && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleRemove}
                  >
                    <Unlink size={14} className="mr-1" />
                    Remove
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleSubmit}
                  disabled={isSubmitDisabled}
                >
                  <Check size={14} className="mr-1" />
                  {!empty ? "Update" : "Insert"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export interface ToolbarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
  active?: boolean;
  disabled?: boolean;
}

function ToolbarButton({
  stroke,
  isActive,
  onToggle,
  icon,
}: {
  icon: React.ReactNode;
  onToggle: () => void;
  isActive: boolean;
  isOption?: boolean;
  stroke: 2 | 3;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={classNames({
        "text-accent": isActive,
        "stroke-[2px]": isActive && stroke === 2,
        "stroke-[3px]": isActive && stroke === 3,
      })}
      onClick={(ev) => {
        ev.preventDefault();
        onToggle();
      }}
    >
      {icon}
    </Button>
  );
}

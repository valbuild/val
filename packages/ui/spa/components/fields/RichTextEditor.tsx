import {
  Remirror,
  useRemirror,
  OnChangeJSON,
  EditorComponent,
  useActive,
  useChainedCommands,
  useAttrs,
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
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../ui/dropdown-menu";
import { DayPickerProvider } from "react-day-picker";
import { RichTextOptions } from "@valbuild/core";
import { createFilename, readImage } from "../../utils/readImage";
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
import { RemirrorJSON as ValRemirrorJSON } from "@valbuild/shared/internal";
import {
  RemirrorJSON,
  RemirrorManager,
  AnyExtension,
  EditorState,
  RemirrorEventListenerProps,
} from "@remirror/core";

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
}: {
  initialContent?: Readonly<EditorState>;
  state?: Readonly<EditorState>;
  manager: RemirrorManager<E>;
  options?: RichTextOptions;
  onChange?: (value: RemirrorEventListenerProps<E>) => void;
  onFocus?: (focused: boolean) => void;
  debug?: boolean;
}) {
  const hasOptions =
    options && Object.entries(options).some(([, value]) => value);
  const [showToolbar, setShowToolbar] = useState(hasOptions);
  const remirrorClassNames = useMemo(() => {
    return [
      classNames(
        "p-4 outline-none focus:outline-none appearance-none bg-background rounded-b-md",
      ),
    ];
  }, [showToolbar]);

  return (
    <div
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
        "relative text-base val-rich-text-editor focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 border border-input rounded-md",
      )}
    >
      <Remirror
        manager={manager}
        initialContent={initialContent}
        state={state}
        classNames={remirrorClassNames}
        onChange={onChange}
      >
        <DayPickerProvider
          initialProps={{
            mode: "default",
          }}
        >
          <Toolbar
            hasOptions={hasOptions}
            options={options}
            debug={debug}
            setShowToolbar={setShowToolbar}
          />
          <EditorComponent />
        </DayPickerProvider>
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
  options?: RichTextOptions;
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
          "sticky top-0 flex flex-col py-2 z-[40] divide-y rounded-md rounded-b-none border-b border-input bg-primary-foreground",
          {
            hidden: !showToolbar,
          },
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex flex-row items-center justify-start px-4 py-1 gap-x-3">
            {(options?.block?.h1 ||
              options?.block?.h2 ||
              options?.block?.h3 ||
              options?.block?.h4 ||
              options?.block?.h5 ||
              options?.block?.h6 ||
              active.heading()) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild className="pr-4">
                  <button>
                    {active.heading({ level: 1 }) && <Heading1 size={22} />}
                    {active.heading({ level: 2 }) && <Heading2 size={22} />}
                    {active.heading({ level: 3 }) && <Heading3 size={22} />}
                    {active.heading({ level: 4 }) && <Heading4 size={22} />}
                    {active.heading({ level: 5 }) && <Heading5 size={22} />}
                    {active.heading({ level: 6 }) && <Heading6 size={22} />}
                    {!active.heading() && "Normal"}
                  </button>
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
            <ToolbarButton
              icon={<Bold size={18} />}
              stroke={3}
              isOption={options?.style?.bold}
              isActive={active.bold()}
              onToggle={() => chain.toggleBold().focus().run()}
            />
            <ToolbarButton
              icon={<Strikethrough size={18} />}
              stroke={3}
              isOption={options?.style?.lineThrough}
              isActive={active.strike()}
              onToggle={() => chain.toggleStrike().focus().run()}
            />
            <ToolbarButton
              icon={<Italic size={18} />}
              stroke={3}
              isOption={options?.style?.italic}
              isActive={active.italic()}
              onToggle={() => chain.toggleItalic().focus().run()}
            />
            <ToolbarButton
              icon={<List size={18} />}
              stroke={3}
              isActive={active.bulletList()}
              onToggle={() => chain.toggleBulletList().focus().run()}
            />
            <ToolbarButton
              icon={<ListOrdered size={18} />}
              stroke={3}
              isActive={active.orderedList()}
              onToggle={() => chain.toggleOrderedList().focus().run()}
            />
            <ToolbarButton
              icon={<Link size={18} />}
              stroke={3}
              isActive={active.link()}
              onToggle={() =>
                chain.selectMark("link").updateLink({ href: "" }).focus().run()
              }
            />
            {(options?.inline?.img || active.image()) && (
              <label
                className="cursor-pointer"
                htmlFor="val-toolbar-image-select"
              >
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
                            createFilename(res.src, res.filename ?? null, {
                              width: res.width,
                              height: res.height,
                              sha256: res.sha256,
                              mimeType: res.mimeType,
                            }) ?? undefined,
                        })
                        .focus()
                        .run();
                    });
                  }}
                />
                <Image
                  size={18}
                  className={`${active.image() && "stroke-[3px]"}`}
                />
              </label>
            )}
            {debug && (
              <button
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chain.insertHardBreak().run()}
              >
                Br
              </button>
            )}
          </div>
        </div>
        <LinkToolBar />
      </div>
    </div>
  );
};

export function LinkToolBar() {
  const chain = useChainedCommands();
  const [href, setHref] = useState<string>();
  const activeLink = useAttrs<LinkExtension>().link();

  useEffect(() => {
    const href =
      typeof activeLink === "object" &&
      "href" in activeLink &&
      typeof activeLink.href === "string"
        ? activeLink.href
        : undefined;
    setHref(href);
  }, [activeLink?.href]);

  const isEnabled =
    //active.link() || // doesn't seem to work for the first char (of a link) of a line, so we could remove this since selectedHref does the trick?
    activeLink !== undefined;
  if (!isEnabled) {
    return null;
  }
  return (
    <div className="flex items-center justify-start px-4 pt-1 gap-x-2">
      <input
        className="bg-transparent text-accent"
        onChange={(ev) => {
          setHref(ev.target.value);
        }}
        defaultValue={href}
        placeholder="https://"
      ></input>
      <button
        className="p-2"
        title="Update"
        disabled={href === undefined}
        onClick={() => {
          if (href !== undefined) {
            chain.selectMark("link").updateLink({ href }).focus().run();
            // This doesn't work inside ShadowRoot? :_( It does selectMark.original("link") so maybe that is the problem?
            // chain.selectLink().updateLink({ href }).focus().run();
          }
        }}
      >
        <Check size={14} />
      </button>
      <button
        className="p-2"
        title="Remove"
        onClick={() => {
          chain.removeLink().focus().run();
        }}
      >
        <Unlink size={13} />
      </button>
    </div>
  );
}

export interface ToolbarButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
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
    <button
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
    </button>
  );
}

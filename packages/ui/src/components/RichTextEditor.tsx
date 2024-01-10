import {
  BoldExtension,
  DropCursorExtension,
  ImageExtension,
  ItalicExtension,
  StrikeExtension,
  BulletListExtension,
  HeadingExtension,
  OrderedListExtension,
  LinkExtension,
  HardBreakExtension,
  ShortcutHandlerProps,
  createMarkPositioner,
} from "remirror/extensions";
import {
  Remirror,
  useRemirror,
  OnChangeJSON,
  EditorComponent,
  useActive,
  useChainedCommands,
  useCurrentSelection,
  FloatingToolbar,
  useAttrs,
  useExtensionEvent,
  useUpdateReason,
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
  Pencil,
  Unlink,
} from "lucide-react";
import {
  ChangeEvent,
  KeyboardEvent,
  MouseEventHandler,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./ui/dropdown-menu";
import { DayPickerProvider } from "react-day-picker";
import {
  AnyRichTextOptions,
  FILE_REF_PROP,
  RichTextOptions,
  RichTextSource,
} from "@valbuild/core";
import {
  parseRichTextSource,
  richTextSourceToRemirror,
} from "@valbuild/shared/internal";
import { Input } from "./ui/input";
import { RemirrorJSON } from "remirror";

const allExtensions = [
  new BoldExtension(),
  new ItalicExtension(),
  new StrikeExtension(),
  new ImageExtension({
    enableResizing: false,
  }),
  new DropCursorExtension(),
  new HeadingExtension({
    levels: [1, 2, 3, 4, 5, 6],
    defaultLevel: 1,
  }),
  new BulletListExtension(),
  new OrderedListExtension(),
  new LinkExtension({ autoLink: true }),
  new HardBreakExtension(),
] as const;

export function RichTextEditor({
  defaultValue,
  options,
  onChange,
  debug,
}: {
  defaultValue?: RichTextSource<AnyRichTextOptions>; // TODO: change this to RemirrorJSON
  options?: RichTextOptions;
  onChange?: (value: RemirrorJSON) => void;
  debug?: boolean;
}) {
  const content =
    defaultValue && richTextSourceToRemirror(parseRichTextSource(defaultValue));
  debug && console.debug("Default", content);
  const { manager, state } = useRemirror({
    extensions: () => allExtensions.slice(), // TODO: filter on options?
    content,
    selection: "start",
    stringHandler: "html",
  });

  const className =
    "p-4 border border-t-0 rounded-md rounded-t-none outline-none appearance-none border-input bg-background";
  return (
    <div className="relative text-base val-rich-text-editor">
      <DayPickerProvider
        initialProps={{
          mode: "default",
        }}
      >
        <Remirror
          manager={manager}
          initialContent={state}
          classNames={[className]}
        >
          {options && <Toolbar options={options} debug={debug} />}
          <EditorComponent />
          <OnChangeJSON
            onChange={(json) => {
              if (debug) {
                console.debug("onChange", json);
              }
              if (onChange) {
                onChange(json);
              }
            }}
          />
        </Remirror>
      </DayPickerProvider>
    </div>
  );
}

function stringifyRichTextSource({
  templateStrings,
  exprs,
}: RichTextSource<AnyRichTextOptions>): string {
  let lines = "";
  for (let i = 0; i < templateStrings.length; i++) {
    const line = templateStrings[i];
    const expr = exprs[i];
    lines += line;
    if (expr) {
      if (expr._type === "file") {
        lines += `\${val.file("${expr[FILE_REF_PROP]}", ${JSON.stringify(
          expr.metadata
        )})}`;
      } else if (expr._type === "link") {
        lines += `\${val.link("${expr.children[0]}", ${JSON.stringify({
          href: expr.href,
        })})}`;
      } else {
        throw Error("Unknown expr: " + JSON.stringify(expr, null, 2));
      }
    }
  }
  return lines;
}

const Toolbar = ({
  options,
  debug,
}: {
  options?: RichTextOptions;
  debug?: boolean;
}) => {
  const chain = useChainedCommands();
  const active = useActive<(typeof allExtensions)[number]>();
  if (!options) return null;
  return (
    <div className="sticky top-0 flex flex-col px-4 py-2 border rounded-md rounded-b-none border-input bg-background">
      <div className="flex flex-row gap-1">
        {options?.headings && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button>
                {active.heading({ level: 1 }) && <Heading1 size={16} />}
                {active.heading({ level: 2 }) && <Heading2 size={16} />}
                {active.heading({ level: 3 }) && <Heading3 size={16} />}
                {active.heading({ level: 4 }) && <Heading4 size={16} />}
                {active.heading({ level: 5 }) && <Heading5 size={16} />}
                {active.heading({ level: 6 }) && <Heading6 size={16} />}
                {!active.heading() && "Normal"}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="text-sm">
              <DropdownMenuItem
                onClick={() => {
                  chain.setBlockNodeType("paragraph").focus().run();
                }}
              >
                Normal
                {/* <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut> */}
              </DropdownMenuItem>
              {options.headings.includes("h1") && (
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
              {options.headings.includes("h2") && (
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
              {options.headings.includes("h3") && (
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
              {options.headings.includes("h4") && (
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
              {options.headings.includes("h5") && (
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
              {options.headings.includes("h5") && (
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
        {options?.bold && (
          <ToolbarButton
            variant="primary"
            onClick={(ev) => {
              ev.preventDefault();
              chain.toggleBold().focus().run();
            }}
          >
            <Bold size={12} className={`${active.bold() && "stroke-[3px]"}`} />
          </ToolbarButton>
        )}
        {options?.bold && (
          <ToolbarButton
            onClick={(ev) => {
              ev.preventDefault();
              chain.toggleStrike().focus().run();
            }}
          >
            <Strikethrough
              size={12}
              className={`${active.strike() && "stroke-[2px]"}`}
            />
          </ToolbarButton>
        )}
        {options?.italic && (
          <ToolbarButton
            onClick={(ev) => {
              ev.preventDefault();
              chain.toggleItalic().focus().run();
            }}
          >
            <Italic
              size={12}
              className={`${active.italic() && "stroke-[3px]"}`}
            />
          </ToolbarButton>
        )}
        {options?.ul && (
          <ToolbarButton
            onClick={(ev) => {
              ev.preventDefault();
              chain.toggleBulletList().focus().run();
            }}
          >
            <List
              size={12}
              className={`${active.bulletList() && "stroke-[3px]"}`}
            />
          </ToolbarButton>
        )}
        {options?.ol && (
          <ToolbarButton
            onClick={(ev) => {
              ev.preventDefault();
              chain.toggleOrderedList().focus().run();
            }}
          >
            <ListOrdered
              size={12}
              className={`${active.orderedList() && "stroke-[3px]"}`}
            />
          </ToolbarButton>
        )}
        {options?.a && (
          <ToolbarButton
            onClick={(ev) => {
              ev.preventDefault();
              chain.updateLink({ href: "" }).focus().run();
            }}
          >
            <Link
              size={12}
              // className={`${url !== null && "stroke-[3px]"}`}
            />
          </ToolbarButton>
        )}
        {options?.img && (
          <ToolbarButton
            onClick={(ev) => {
              ev.preventDefault();
            }}
          >
            <Image
              size={12}
              // className={`${url !== null && "stroke-[3px]"}`}
            />
          </ToolbarButton>
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
      <FloatingLinkToolbar />
    </div>
  );
};

export interface ToolbarButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
  active?: boolean;
  disabled?: boolean;
}

function ToolbarButton({
  variant = "primary",
  onClick,
  children,
  disabled = false,
}: {
  variant?: "primary" | "secondary";
  onClick?: MouseEventHandler<HTMLButtonElement>;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      className={classNames(
        "font-sans font-[12px] tracking-[0.04em] py-1 px-2 rounded whitespace-nowrap group relative text-primary",
        {
          "font-bold": variant === "primary",
          "text-fill disabled:bg-fill disabled:text-background":
            variant === "primary",
          "border border-primary text-primary hover:border-highlight hover:text-highlight disabled:bg-fill disabled:text-background":
            variant !== "primary",
        }
      )}
      onClick={onClick}
    >
      <span className="flex flex-row items-center justify-center gap-2">
        {children}
      </span>
    </button>
  );
}

function useLinkShortcut() {
  const [linkShortcut, setLinkShortcut] = useState<
    ShortcutHandlerProps | undefined
  >();
  const [isEditing, setIsEditing] = useState(false);

  useExtensionEvent(
    LinkExtension,
    "onShortcut",
    useCallback(
      (props) => {
        console.log("onShortCut", { props });
        if (!isEditing) {
          setIsEditing(true);
        }

        return setLinkShortcut(props);
      },
      [isEditing]
    )
  );

  return { linkShortcut, isEditing, setIsEditing };
}

function useFloatingLinkState() {
  const chain = useChainedCommands();
  const { isEditing, linkShortcut, setIsEditing } = useLinkShortcut();
  const { to, empty } = useCurrentSelection();

  const url = (useAttrs().link()?.href as string) ?? "";
  const [href, setHref] = useState<string>(url);

  // A positioner which only shows for links.
  const linkPositioner = useMemo(
    () => createMarkPositioner({ type: "link" }),
    []
  );

  const onRemove = useCallback(() => chain.removeLink().focus().run(), [chain]);

  const updateReason = useUpdateReason();

  useLayoutEffect(() => {
    if (!isEditing) {
      return;
    }

    if (updateReason.doc || updateReason.selection) {
      setIsEditing(false);
    }
  }, [isEditing, setIsEditing, updateReason.doc, updateReason.selection]);

  useEffect(() => {
    setHref(url);
  }, [url]);

  const submitHref = useCallback(() => {
    setIsEditing(false);
    const range = linkShortcut ?? undefined;

    console.log("submit");
    if (!href || href === "") {
      chain
        .removeLink()
        .focus(range?.to ?? to)
        .run();
    } else {
      console.log("updateLink", { href, auto: false }, range);
      chain
        .updateLink({ href, auto: false }, range)
        .focus(range?.to ?? to)
        .run();
    }
  }, [setIsEditing, linkShortcut, chain, href, to]);

  const cancelHref = useCallback(() => {
    setIsEditing(false);
  }, [setIsEditing]);

  const clickEdit = useCallback(() => {
    if (empty) {
      chain.selectLink();
    }

    setIsEditing(true);
  }, [chain, empty, setIsEditing]);

  return useMemo(
    () => ({
      href,
      setHref,
      linkShortcut,
      linkPositioner,
      isEditing,
      clickEdit,
      onRemove,
      submitHref,
      cancelHref,
    }),
    [
      href,
      linkShortcut,
      linkPositioner,
      isEditing,
      clickEdit,
      onRemove,
      submitHref,
      cancelHref,
    ]
  );
}

const FloatingLinkToolbar = () => {
  const {
    isEditing,
    linkPositioner,
    clickEdit,
    onRemove,
    submitHref,
    href,
    setHref,
    cancelHref,
  } = useFloatingLinkState();
  const active = useActive();
  const activeLink = active.link();
  const { empty } = useCurrentSelection();

  const handleClickEdit = useCallback(() => {
    clickEdit();
  }, [clickEdit]);

  const linkEditButtons = activeLink ? (
    <div className="text-primary-foreground bg-primary">
      <button onClick={handleClickEdit}>
        <Pencil />
      </button>
      <button onClick={onRemove}>
        <Unlink />
      </button>
    </div>
  ) : (
    <button onClick={handleClickEdit}>
      <Link />
    </button>
  );

  return (
    <>
      {!isEditing && <FloatingToolbar>{linkEditButtons}</FloatingToolbar>}
      {!isEditing && empty && (
        <FloatingToolbar positioner={linkPositioner}>
          {linkEditButtons}
        </FloatingToolbar>
      )}

      {isEditing && (
        <div className="flex p-4 text-primary bg-background">
          <Input
            placeholder="Enter link..."
            autoFocus
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setHref(event.target.value)
            }
            value={href}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              // const { code } = event;
              // if (code === "Enter") {
              //   submitHref();
              // }
              // if (code === "Escape") {
              //   cancelHref();
              // }
            }}
          ></Input>
          <button
            onClick={(ev) => {
              ev.preventDefault();
              submitHref();
            }}
          >
            Submit
          </button>
        </div>
      )}
    </>
  );
};

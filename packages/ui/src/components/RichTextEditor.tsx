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
} from "remirror/extensions";
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
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./ui/dropdown-menu";
import { DayPickerProvider } from "react-day-picker";
import { RichTextOptions } from "@valbuild/core";
import {
  AnyExtension,
  ChainedFromExtensions,
  EditorState,
  RemirrorJSON,
  RemirrorManager,
} from "remirror";
import { createFilename, readImage } from "../utils/readImage";

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

export function useRichTextEditor(defaultValue?: RemirrorJSON) {
  const { manager, state } = useRemirror({
    extensions: () => allExtensions.slice(), // TODO: filter on options?
    content: defaultValue,
    selection: "start",
  });
  return { manager, state };
}

export function RichTextEditor<E extends AnyExtension>({
  state,
  manager,
  options,
  onChange,
  debug,
}: {
  state: Readonly<EditorState>;
  manager: RemirrorManager<E>;
  options?: RichTextOptions;
  onChange?: (value: RemirrorJSON) => void;
  debug?: boolean;
}) {
  const hasOptions =
    options && Object.entries(options).some(([, value]) => value);
  const [showToolbar, setShowToolbar] = useState(hasOptions);
  const className = classNames(
    "p-4 border rounded-md outline-none appearance-none border-input bg-background",
    {
      "rounded-t-none border-t-0": showToolbar,
    }
  );
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
          <Toolbar
            hasOptions={hasOptions}
            options={options}
            debug={debug}
            onShowToolbar={(showToolbar) => {
              setShowToolbar(showToolbar);
            }}
          />
          <EditorComponent />
          {onChange && <OnChangeJSON onChange={onChange} />}
        </Remirror>
      </DayPickerProvider>
    </div>
  );
}

const Toolbar = ({
  options,
  hasOptions,
  onShowToolbar,
  debug,
}: {
  options?: RichTextOptions;
  hasOptions?: boolean;
  onShowToolbar: (showToolbar: boolean) => void;
  debug?: boolean;
}) => {
  const chain = useChainedCommands();

  const active = useActive<(typeof allExtensions)[number]>();

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
    onShowToolbar(showToolbar);
  }, [showToolbar]);

  return (
    <div
      className={classNames(
        "sticky top-0 flex flex-col py-2 border divide-y rounded-md rounded-b-none border-input bg-background divide-input",
        {
          hidden: !showToolbar,
        }
      )}
    >
      <div className="flex flex-row items-center justify-start px-4 py-1 gap-x-2">
        {(options?.headings || active.heading()) && (
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
            <DropdownMenuContent>
              <DropdownMenuItem
                onClick={() => {
                  chain.setBlockNodeType("paragraph").focus().run();
                }}
              >
                Normal
                {/* <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut> */}
              </DropdownMenuItem>
              {options?.headings?.includes("h1") && (
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
              {options?.headings?.includes("h2") && (
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
              {options?.headings?.includes("h3") && (
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
              {options?.headings?.includes("h4") && (
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
              {options?.headings?.includes("h5") && (
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
              {options?.headings?.includes("h5") && (
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
          mark="bold"
          isOption={options?.bold}
          isActive={active.bold()}
          onToggle={(chain) => chain.toggleBold().focus().run()}
        />
        <ToolbarButton
          icon={<Strikethrough size={18} />}
          stroke={3}
          mark="strike"
          isOption={options?.lineThrough}
          isActive={active.strike()}
          onToggle={(chain) => chain.toggleStrike().focus().run()}
        />
        <ToolbarButton
          icon={<Italic size={18} />}
          stroke={3}
          mark="italic"
          isOption={options?.italic}
          isActive={active.italic()}
          onToggle={(chain) => chain.toggleItalic().focus().run()}
        />
        <ToolbarButton
          icon={<List size={18} />}
          stroke={3}
          mark="bulletList"
          isOption={options?.ul}
          isActive={active.bulletList()}
          onToggle={(chain) => chain.toggleBulletList().focus().run()}
        />
        <ToolbarButton
          icon={<ListOrdered size={18} />}
          stroke={3}
          mark="list"
          isOption={options?.ol}
          isActive={active.orderedList()}
          onToggle={(chain) => chain.toggleOrderedList().focus().run()}
        />
        <ToolbarButton
          icon={<Link size={18} />}
          stroke={3}
          mark="link"
          isOption={options?.ol}
          isActive={active.link()}
          onToggle={(chain) => chain.updateLink({ href: "" }).focus().run()}
        />
        {(options?.img || active.image()) && (
          <label
            className="px-2 py-1 cursor-pointer"
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
      <LinkToolBar />
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
  mark,
  isOption,
  isActive,
  onToggle,
  icon,
}: {
  icon: React.ReactNode;
  mark: string;
  onToggle: (
    chain: ChainedFromExtensions<AnyExtension | Remirror.Extensions>
  ) => void;
  isActive: boolean;
  isOption?: boolean;
  stroke: 2 | 3;
}) {
  const chain = useChainedCommands();
  if (!isOption && !isActive) {
    return null;
  }
  return (
    <button
      className={classNames({
        "text-accent": isActive,
        "stroke-[2px]": isActive && stroke === 2,
        "stroke-[3px]": isActive && stroke === 3,
      })}
      onClick={(ev) => {
        ev.preventDefault();
        if (!isOption) {
          onToggle(chain.selectMark(mark));
        } else {
          onToggle(chain);
        }
      }}
    >
      {icon}
    </button>
  );
}

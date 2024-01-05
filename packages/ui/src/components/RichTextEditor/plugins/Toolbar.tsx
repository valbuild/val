/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
  $isListNode,
  ListNode,
} from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createHeadingNode,
  $isHeadingNode,
  HeadingTagType,
} from "@lexical/rich-text";
import { $patchStyleText, $setBlocksType } from "@lexical/selection";
import {
  $findMatchingParent,
  $getNearestBlockElementAncestorOrThrow,
  mergeRegister,
  $getNearestNodeOfType,
} from "@lexical/utils";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $isTextNode,
  COMMAND_PRIORITY_CRITICAL,
  DEPRECATED_$isGridSelection,
  FORMAT_TEXT_COMMAND,
  LexicalEditor,
  NodeKey,
  SELECTION_CHANGE_COMMAND,
} from "lexical";
import { FC, SVGProps, useCallback, useEffect, useState } from "react";
import Bold from "../../../assets/icons/Bold";
import ImageIcon from "../../../assets/icons/ImageIcon";
import Italic from "../../../assets/icons/Italic";
import Strikethrough from "../../../assets/icons/Strikethrough";
import Dropdown from "../../Dropdown";
import { INSERT_IMAGE_COMMAND } from "./ImagePlugin";
import { readImage } from "../../../utils/readImage";
import { $isLinkNode, LinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { getSelectedNode } from "./LinkEditorPlugin";
import { Check, Link, X } from "react-feather";
import classNames from "classnames";

export interface ToolbarSettingsProps {
  fontsFamilies?: string[];
  fontSizes?: string[];
  colors?: string[];
  onEditor?: (editor: LexicalEditor) => void;
}

const Toolbar: FC<ToolbarSettingsProps> = ({
  fontSizes,
  fontsFamilies,
  onEditor,
  colors,
}) => {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (onEditor) {
      onEditor(editor);
    }
  }, [editor]);
  const [activeEditor, setActiveEditor] = useState(editor);
  const [selectedElementKey, setSelectedElementKey] = useState<NodeKey | null>(
    null
  );
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isStrikethrough, setIsStrikethrough] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [fontSize, setFontSize] = useState<string>("15px");
  const [fontColor, setFontColor] = useState<string>("#000");
  const [fontFamily, setFontFamily] = useState<string>("Sans");
  const [blockType, setBlockType] =
    useState<keyof typeof blockTypes>("paragraph");

  const [showModal, setShowModal] = useState<boolean>(false);
  const [inputUrl, setInputUrl] = useState<boolean>(false);
  const [uploadMode, setUploadMode] = useState<"url" | "file">("url");
  const [file, setFile] = useState<File | null>(null);

  const [url, setUrl] = useState<string | null>(null);

  const dispatchLinkChange = (url: string | null) => {
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
  };

  const blockTypes: { [key: string]: string } = {
    paragraph: "Normal",
    h1: "Heading 1",
    h2: "Heading 2",
    h3: "Heading 3",
    h4: "Heading 4",
    h5: "Heading 5",
    h6: "Heading 6",
    number: "Numbered List",
    bullet: "Bulleted List",
  };
  const blockTypesLookup: { [key: string]: string } = {};

  for (const key in blockTypes) {
    blockTypesLookup[blockTypes[key]] = key;
  }

  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      const anchorNode = selection.anchor.getNode();
      let element =
        anchorNode.getKey() === "root"
          ? anchorNode
          : $findMatchingParent(anchorNode, (e) => {
              const parent = e.getParent();
              return parent !== null && $isRootOrShadowRoot(parent);
            });

      if (element === null) {
        element = anchorNode.getTopLevelElementOrThrow();
      }

      // LINK STUFF
      const node = getSelectedNode(selection);
      const linkParent = $findMatchingParent(
        node,
        $isLinkNode
      ) as LinkNode | null;
      if (linkParent !== null) {
        const href = linkParent.getURL();
        setUrl(href);
      } else {
        setUrl(null);
      }
      // ====================

      const elementKey = element.getKey();
      const elementDOM = activeEditor.getElementByKey(elementKey);
      setIsBold(selection.hasFormat("bold"));
      setIsItalic(selection.hasFormat("italic"));
      setIsStrikethrough(selection.hasFormat("strikethrough"));
      setIsUnderline(selection.hasFormat("underline"));
      if (elementDOM !== null) {
        setSelectedElementKey(elementKey);
        if ($isListNode(element)) {
          const parentList = $getNearestNodeOfType<ListNode>(
            anchorNode,
            ListNode
          );
          const type = parentList
            ? parentList.getListType()
            : element.getListType();
          setBlockType(type);
        } else {
          const type = $isHeadingNode(element)
            ? element.getTag()
            : element.getType();
          if (type in blockTypes) {
            setBlockType(type as keyof typeof blockTypes);
          }
        }
      }

      // setFontSize(
      //   $getSelectionStyleValueForProperty(selection, "font-size", "15px")
      // );
      // setFontColor(
      //   $getSelectionStyleValueForProperty(selection, "color", "#000")
      // );
      // setFontFamily(
      //   $getSelectionStyleValueForProperty(selection, "font-family", "Arial")
      // );
    }
  }, [activeEditor]);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          updateToolbar();
        });
      })
    );
  }, [updateToolbar, activeEditor, editor]);

  useEffect(() => {
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      (_payload, newEditor) => {
        updateToolbar();
        setActiveEditor(newEditor);
        return false;
      },
      COMMAND_PRIORITY_CRITICAL
    );
  }, [editor, updateToolbar]);

  const formatText = (format: keyof typeof blockTypes) => {
    if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(format as string)) {
      if (blockType !== format) {
        editor.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            $setBlocksType(selection, () => {
              return $createHeadingNode(format as HeadingTagType);
            });
          }
        });
      }
    } else if (format === "paragraph" && blockType !== "paragraph") {
      editor.update(() => {
        const selection = $getSelection();
        if (
          $isRangeSelection(selection) ||
          DEPRECATED_$isGridSelection(selection)
        ) {
          $setBlocksType(selection, () => $createParagraphNode());
        }
      });
    } else {
      if (format === "number" && blockType !== "number") {
        editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
      } else if (format === "bullet" && blockType !== "bullet") {
        editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
      } else {
        editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      }
    }
  };

  const clearFormatting = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        const anchor = selection.anchor;
        const focus = selection.focus;
        const nodes = selection.getNodes();

        if (anchor.key === focus.key && anchor.offset === focus.offset) {
          return;
        }
        nodes.forEach((node, idx) => {
          if ($isTextNode(node)) {
            if (idx === 0 && anchor.offset !== 0) {
              node = node.splitText(anchor.offset)[1] || node;
            }
            if (idx === nodes.length - 1) {
              node = node.splitText(focus.offset)[0] || node;
            }

            if (node.__style !== "") {
              node.setStyle("");
            }
            if (node.__format !== 0) {
              node.setFormat(0);
              $getNearestBlockElementAncestorOrThrow(node).setFormat("");
            }
          } else if ($isHeadingNode(node)) {
            node.replace($createParagraphNode(), true);
          }
        });
      }
    });
  }, [activeEditor]);

  const changeFontFamily = (fontFamily: string) => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $patchStyleText(selection, {
          ["font-family"]: fontFamily,
        });
      }
    });
  };

  const changeFontSize = (fontSize: string) => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $patchStyleText(selection, {
          ["font-size"]: fontSize,
        });
      }
    });
  };

  return (
    <div className="sticky top-0 flex flex-col px-4 py-2 border rounded-md rounded-b-none border-input bg-background">
      <div className="flex flex-row gap-1">
        <Dropdown
          options={Object.values(blockTypes)}
          label={
            blockTypes[blockType as string] ?? blockType + " (not supported)"
          }
          onChange={(selectedOption) => {
            formatText(blockTypesLookup[selectedOption]);
          }}
        />
        <ToolbarButton
          variant="primary"
          onClick={(ev) => {
            ev.preventDefault();
            editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold");
          }}
          active={isBold}
          icon={<Bold className={`${isBold && "stroke-[3px]"}`} />}
        />
        <ToolbarButton
          active={isStrikethrough}
          onClick={(ev) => {
            ev.preventDefault();
            editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough");
          }}
          icon={
            <Strikethrough className={`${isStrikethrough && "stroke-[2px]"}`} />
          }
        />
        <ToolbarButton
          active={isItalic}
          onClick={(ev) => {
            ev.preventDefault();
            editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic");
          }}
          icon={<Italic className={`${isItalic && "stroke-[3px]"}`} />}
        />
        <ToolbarButton
          active={url !== null}
          onClick={(ev) => {
            ev.preventDefault();
            setUrl("");
            dispatchLinkChange("");
          }}
          icon={
            <Link
              width={12}
              height={12}
              className={`${url !== null && "stroke-[3px]"}`}
            />
          }
        />
        <label className="flex items-center justify-center cursor-pointer">
          <ImageIcon />
          <input
            type="file"
            hidden={true}
            onChange={(ev) => {
              ev.preventDefault();

              readImage(ev)
                .then((res) => {
                  editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
                    ...res,
                  });
                })
                .catch((err) => {
                  console.error("Error reading image", err);
                });
            }}
          />
        </label>
      </div>
      {url !== null && (
        <div className="flex flex-row p-2">
          <input
            type="text"
            placeholder="Enter URL"
            className="w-1/3 px-2 bg-background text-primary"
            value={url}
            onChange={(ev) => {
              ev.preventDefault();
              setUrl(ev.target.value);
            }}
          ></input>
          <ToolbarButton
            variant="primary"
            onClick={(ev) => {
              ev.preventDefault();
              // empty url will remove link
              dispatchLinkChange(url || null);
            }}
            icon={<Check size={14} />}
          />
          <ToolbarButton
            variant="primary"
            onClick={(ev) => {
              ev.preventDefault();
              dispatchLinkChange(null);
            }}
            icon={<X size={14} />}
          />
        </div>
      )}
    </div>
  );
};

export interface ToolbarButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
  icon?: React.ReactElement<SVGProps<SVGSVGElement>>;
  active?: boolean;
  disabled?: boolean;
}

const ToolbarButton: FC<ToolbarButtonProps> = ({
  variant = "primary",
  onClick,
  children,
  icon,
  // active = false,
  disabled = false,
}) => {
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
        {icon && icon}
        {children}
      </span>
    </button>
  );
};

export default Toolbar;

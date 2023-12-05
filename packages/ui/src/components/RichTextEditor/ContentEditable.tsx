import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import * as React from "react";
import { useCallback, useState } from "react";
import "../../richtext/shadowRootPolyFill";

export type Props = {
  ariaActiveDescendant?: React.AriaAttributes["aria-activedescendant"];
  ariaAutoComplete?: React.AriaAttributes["aria-autocomplete"];
  ariaControls?: React.AriaAttributes["aria-controls"];
  ariaDescribedBy?: React.AriaAttributes["aria-describedby"];
  ariaExpanded?: React.AriaAttributes["aria-expanded"];
  ariaLabel?: React.AriaAttributes["aria-label"];
  ariaLabelledBy?: React.AriaAttributes["aria-labelledby"];
  ariaMultiline?: React.AriaAttributes["aria-multiline"];
  ariaOwns?: React.AriaAttributes["aria-owns"];
  ariaRequired?: React.AriaAttributes["aria-required"];
  autoCapitalize?: HTMLDivElement["autocapitalize"];
  "data-testid"?: string | null | undefined;
} & React.AllHTMLAttributes<HTMLDivElement>;

export function ContentEditable({
  ariaActiveDescendant,
  ariaAutoComplete,
  ariaControls,
  ariaDescribedBy,
  ariaExpanded,
  ariaLabel,
  ariaLabelledBy,
  ariaMultiline,
  ariaOwns,
  ariaRequired,
  autoCapitalize,
  className,
  id,
  role = "textbox",
  spellCheck = true,
  style,
  tabIndex,
  "data-testid": testid,
  ...rest
}: Props): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [isEditable, setEditable] = useState(false);

  const ref = useCallback(
    (rootElement: null | HTMLElement) => {
      editor.setRootElement(rootElement);
      const shadowRoot = document.getElementById("val-ui")?.shadowRoot;
      if (!shadowRoot) {
        return;
      }
      // Lexical doesnt officially support shadow dom yet, but this is a workaround
      // It happens to work in firefox since their document.getSelection pierces shadow dom
      // Chrome does not do this,. but has getSelection on the shadowRoot
      // Safari does not have getSelection on the shadowRoot, and document.getSelection does not pierce shadow dom
      // So for Safari this is polyfilled in shadowRootPolyFill.js
      // https://github.com/facebook/lexical/issues/2119
      //
      // In the code below we have a hack to override the window object on the editor with the shadowRoot
      // then it will call getSelection on the shadowRoot instead of the document
      if ("getSelection" in shadowRoot) {
        // safari (if polyfilled) and chrome
        editor._window = shadowRoot as unknown as Window;
        return;
      }
    },
    [editor]
  );

  React.useLayoutEffect(() => {
    setEditable(editor.isEditable());
    return editor.registerEditableListener((currentIsEditable) => {
      setEditable(currentIsEditable);
    });
  }, [editor]);

  return (
    <div
      {...rest}
      aria-activedescendant={!isEditable ? undefined : ariaActiveDescendant}
      aria-autocomplete={!isEditable ? "none" : ariaAutoComplete}
      aria-controls={!isEditable ? undefined : ariaControls}
      aria-describedby={ariaDescribedBy}
      aria-expanded={
        !isEditable
          ? undefined
          : role === "combobox"
          ? !!ariaExpanded
          : undefined
      }
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-multiline={ariaMultiline}
      aria-owns={!isEditable ? undefined : ariaOwns}
      aria-readonly={!isEditable ? true : undefined}
      aria-required={ariaRequired}
      autoCapitalize={autoCapitalize}
      className={className}
      contentEditable={isEditable}
      data-testid={testid}
      id={id}
      ref={ref}
      role={role}
      spellCheck={spellCheck}
      style={style}
      tabIndex={tabIndex}
    />
  );
}

export default function LexicalContentEditable({
  className,
}: {
  className?: string;
}): JSX.Element {
  return <ContentEditable className={className} />;
}

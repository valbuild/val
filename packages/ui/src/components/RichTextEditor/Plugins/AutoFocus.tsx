import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";


export function AutoFocus() {
    const [editor] = useLexicalComposerContext();
  
    useEffect(() => {
      editor.focus();
    }, [editor]);
  
    return null;
  }
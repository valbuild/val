import { CodeLanguage } from "@valbuild/core";
import CodeMirror, { BasicSetupOptions } from "@uiw/react-codemirror";
import { useMemo, useState } from "react";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { java } from "@codemirror/lang-java";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { xml } from "@codemirror/lang-xml";
import { markdown } from "@codemirror/lang-markdown";
import { sql } from "@codemirror/lang-sql";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { php } from "@codemirror/lang-php";
import { go } from "@codemirror/lang-go";
import { cpp } from "@codemirror/lang-cpp";
import { sass } from "@codemirror/lang-sass";
import { vue } from "@codemirror/lang-vue";
import { angular } from "@codemirror/lang-angular";
import { createTheme, Settings } from "@uiw/codemirror-themes";
import { tags as t } from "@lezer/highlight";
import { cn } from "./designSystem/cn";
import { useTheme } from "./ValThemeProvider";
import { TagStyle } from "@codemirror/language";

export function CodeEditor({
  language,
  value,
  onChange,
  autoFocus,
  placeholder,
  options,
  className,
}: {
  language: CodeLanguage;
  placeholder?: string;
  options?: BasicSetupOptions;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const extensions = useMemo(() => {
    if (language === "typescript") {
      return [javascript({ typescript: true })];
    } else if (language === "typescriptreact") {
      return [javascript({ jsx: true, typescript: true })];
    } else if (language === "javascript") {
      return [javascript()];
    } else if (language === "javascriptreact") {
      return [javascript({ jsx: true })];
    } else if (language === "json") {
      return [json()];
    } else if (language === "java") {
      return [java()];
    } else if (language === "html") {
      return [html()];
    } else if (language === "css") {
      return [css()];
    } else if (language === "xml") {
      return [xml()];
    } else if (language === "markdown") {
      return [markdown()];
    } else if (language === "sql") {
      return [sql()];
    } else if (language === "python") {
      return [python()];
    } else if (language === "rust") {
      return [rust()];
    } else if (language === "php") {
      return [php()];
    } else if (language === "go") {
      return [go()];
    } else if (language === "cpp") {
      return [cpp()];
    } else if (language === "sass") {
      return [sass()];
    } else if (language === "vue") {
      return [vue()];
    } else if (language === "angular") {
      return [angular()];
    } else {
      const exhaustiveCheck: never = language;
      console.error(`Unknown code editor language: ${exhaustiveCheck}`);
      return [];
    }
  }, [language]);
  const uiTheme = useTheme();
  const root =
    document.getElementById("val-shadow-root")?.shadowRoot ?? undefined;
  const theme = useMemo(() => {
    if (uiTheme.theme === "dark") {
      return valDarkTheme;
    } else {
      return valLightTheme;
    }
  }, [uiTheme]);
  const [focused, setFocused] = useState(false);

  return (
    <div
      className={cn(
        "m-1 p-2 bg-bg-primary rounded-md border border-border-primary",
        {
          "ring-2 ring-offset-2": focused,
        },
      )}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        autoFocus={autoFocus}
        extensions={extensions}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        theme={theme}
        placeholder={placeholder}
        className={cn(className, "max-h-[300px] overflow-y-auto")}
        root={root}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,

          ...options,
        }}
      />
    </div>
  );
}

const commonTheme: {
  settings: Settings;
  styles: TagStyle[];
} = {
  settings: {
    background: "var(--bg-primary)",
    foreground: "var(--fg-primary)",
    caret: "var(--fg-primary)",
    selection: "var(--bg-selection)",
    selectionMatch: "var(--bg-selection)",
    lineHighlight: "transparent",
    gutterBackground: "var(--bg-primary)",
    gutterForeground: "var(--fg-primary-alt)",
  },
  styles: [
    { tag: t.invalid, color: "var(--fg-error-primary)" },
    { tag: t.comment, color: "var(--fg-primary-alt)" },
    { tag: t.variableName, color: "var(--fg-primary-alt)" },
    {
      tag: [t.string, t.special(t.brace)],
      color: "var(--fg-brand-primary-alt)",
    },
    { tag: t.number, color: "var(--fg-primary)" },
    { tag: t.bool, color: "var(--fg-primary)" },
    { tag: t.null, color: "var(--fg-primary)" },
    { tag: t.keyword, color: "var(--fg-brand-primary-alt)" },
    { tag: t.operator, color: "var(--fg-primary)" },
    { tag: t.className, color: "var(--fg-primary)" },
    { tag: t.definition(t.typeName), color: "var(--fg-primary)" },
    { tag: t.typeName, color: "var(--fg-primary)" },
    { tag: t.angleBracket, color: "var(--fg-primary-alt)" },
    { tag: t.tagName, color: "var(--fg-primary-alt)" },
    { tag: t.attributeName, color: "var(--fg-primary-alt)" },
  ],
};

const valLightTheme = createTheme({
  theme: "light",
  ...commonTheme,
});

const valDarkTheme = createTheme({
  ...valLightTheme,
  theme: "dark",
  ...commonTheme,
});

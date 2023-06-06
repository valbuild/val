export default {};

const tailwindConfig = {
  fontFamily: {
    sans: ["Inter", "sans-serif"],
    serif: ["Merriweather", "serif"],
  },
  fontSize: {
    xs: "0.75rem",
    sm: "0.875rem",
    base: "1rem",
    lg: "1.125rem",
    xl: "1.25rem",
  },
  fontWeight: {
    normal: 400,
    bold: 700,
  },
  lineHeight: {
    none: 1,
    tight: 1.25,
    snug: 1.375,
    normal: 1.5,
    relaxed: 1.625,
    loose: 2,
  },
  letterSpacing: {
    tighter: "-0.05em",
    tight: "-0.025em",
    normal: "0em",
    wide: "0.025em",
    wider: "0.05em",
    widest: "0.1em",
  },
  colors: {
    transparent: "transparent",
    current: "currentColor",
    black: "#000",
    white: "#fff",
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
const richtext = (any: any): any => {
  throw new Error("Method not implemented.");
};

richtext({
  transform: {
    theme: tailwindConfig,
    classNames: {
      tags: {
        h1: "text-4xl font-bold",
        h2: "text-3xl font-bold",
        h3: "text-2xl font-bold",
        ul: "list-disc list-inside",
        ol: "list-decimal list-inside",
      },
    },
  },
});

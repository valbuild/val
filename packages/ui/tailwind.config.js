/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [__dirname + "/src/**/*.{js,ts,jsx,tsx}"],
  darkMode: ["class", '[data-mode="dark"]'],
  theme: {
    zIndex: {
      hover: 1,
      window: 2,
      full: 3,
      overlay: 4,
    },
    colors: {
      base: "var(--val-theme-base)",
      highlight: "var(--val-theme-highlight)",
      border: "var(--val-theme-border)",
      fill: "var(--val-theme-fill)",
      primary: "var(--val-theme-primary)",
      full: "var(--val-theme-full)",
      //
      white: "#FCFCFC",
      "light-gray": "#D6D6D6",
      "dark-gray": "#575757",
      "medium-black": "#303030",
      "warm-black": "#1A1A1A",
      yellow: "#38CD98",
      red: "#F02929",
      green: "#1CED1C",
    },
    spacing: {
      0: "0px",
      1: "4px",
      2: "8px",
      3: "12px",
      4: "16px",
    },
    screens: {
      tablet: "640px",
    },
    fontFamily: {
      sans: "'Roboto', sans-serif",
      serif: "'Space Mono', monospace",
    },
    keyframes: {
      rotateLeft: {
        "0%": { transform: "rotate(0deg)" },
        "100%": { transform: "rotate(45deg)" },
      },
      rotateRight: {
        "0%": { transform: "rotate(0deg)" },
        "100%": { transform: "rotate(-45deg)" },
      },
      spin: {
        "0%": { transform: "rotate(0deg)" },
        "100%": { transform: "rotate(360deg)" },
      },
    },
    animation: {
      rotateLeft: "rotateLeft 200ms ease-in-out",
      rotateRight: "rotateRight 200ms ease-in-out",
      spin: "spin 1s linear infinite",
    },
    transitionProperty: {
      opacity: ["opacity"],
    },
  },
  plugins: [
    function ({ addVariant }) {
      addVariant("all-but-last-child", "& > *:not(:last-child)");
      addVariant("children", "& *");
    },
  ],
};

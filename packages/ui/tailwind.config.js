/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [__dirname + "/src/**/*.{js,ts,jsx,tsx}"],
  darkMode: ["class", '[data-mode="dark"]'],
  theme: {
    colors: {
      base: "var(--val-theme-base)",
      highlight: "var(--val-theme-highlight)",
      border: "var(--val-theme-border)",
      fill: "var(--val-theme-fill)",
      primary: "var(--val-theme-primary)",
      //
      white: "#FCFCFC",
      "light-gray": "#D6D6D6",
      "dark-gray": "#575757",
      "medium-black": "#303030",
      "warm-black": "#1A1A1A",
      yellow: "#FFFF00",
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
  },
  plugins: [],
};

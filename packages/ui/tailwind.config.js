/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [__dirname + "/src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        valWhite: "#FCFCFC",
        valLightGrey: "#D6D6D6",
        valDarkGrey: "#575757",
        valMediumBlack: "#303030",
        valWarmBlack: "#1A1A1A",
        valYellow: "#FFFF00",
        valRed: "#F02929",
        valGreen: "#1CED1C",
      },
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
    },
    animation: {
      rotateLeft: "rotateLeft 200ms ease-in-out",
      rotateRight: "rotateRight 200ms ease-in-out",
    },
  },
  plugins: [],
};

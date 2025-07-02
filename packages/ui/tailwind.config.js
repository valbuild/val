/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [__dirname + "/spa/**/*.{js,ts,jsx,tsx}"],
  darkMode: ["class", '[data-mode="dark"]'],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
        md: "1000px",
      },
    },
    zIndex: {
      hover: 1,
      window: 2,
      full: 3,
      overlay: 4,
      5: 5,
      50: 50,
    },

    fontFamily: {
      sans: "'DM Sans', sans-serif",
      serif: "'Space Grotesk', sans-serif",
    },
    extend: {
      colors: {
        /* (Text) Selection colors */
        "bg-selection": "var(--bg-selection)",
        "text-selection": "var(--text-selection)",

        /* Primary colors */
        "bg-primary": "var(--bg-primary)",
        "fg-primary": "var(--fg-primary)",
        "border-primary": "var(--border-primary)",

        /* Secondary colors */
        "bg-secondary": "var(--bg-secondary)",
        "bg-secondary-hover": "var(--bg-secondary-hover)",
        "fg-secondary": "var(--fg-secondary)",
        "border-secondary": "var(--border-secondary)",

        /* Tertiary colors */
        "bg-tertiary": "var(--bg-tertiary)",
        "fg-tertiary": "var(--fg-tertiary)",

        /* Quaternary colors */
        "bg-quaternary": "var(--bg-quaternary)",
        "fg-quaternary": "var(--fg-quaternary)",

        /* Brand colors */
        /* Brand primary */
        "bg-brand-primary": "var(--bg-brand-primary)",
        "bg-brand-primary-hover": "var(--bg-brand-primary-hover)",
        "fg-brand-primary": "var(--fg-brand-primary)",
        "fg-brand-primary-alt": "var(--fg-brand-primary-alt)",
        "border-brand-primary": "var(--border-brand-primary)",
        /* Brand secondary */
        "bg-brand-secondary": "var(--bg-brand-secondary)",
        "bg-brand-secondary-hover": "var(--bg-brand-secondary-hover)",
        "fg-brand-secondary": "var(--fg-brand-secondary)",
        "fg-brand-secondary-alt": "var(--fg-brand-secondary-alt)",
        "border-brand-secondary": "var(--border-brand-secondary)",

        /* Warning colors */
        "bg-warning-primary": "var(--bg-warning-primary)",

        /* Error colors */
        /* Error primary */
        "bg-error-primary": "var(--bg-error-primary)",
        "bg-error-primary-hover": "var(--bg-error-primary-hover)",
        "fg-error-primary": "var(--fg-error-primary)",
        "fg-error-primary-alt": "var(--fg-error-primary-alt)",
        "border-error-primary": "var(--border-error-primary)",
        /* Error secondary */
        "bg-error-secondary": "var(--bg-error-secondary)",
        "bg-error-secondary-hover": "var(--bg-error-secondary-hover)",
        "fg-error-secondary": "var(--fg-error-secondary)",
        "fg-error-secondary-alt": "var(--fg-error-secondary-alt)",
        "border-error-secondary": "var(--border-error-secondary)",

        /* Disabled colors */
        "bg-disabled": "var(--bg-disabled)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: 0 },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: 0 },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

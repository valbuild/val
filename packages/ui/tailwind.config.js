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
        "bg-primary-solid": "var(--bg-primary-solid)",
        "fg-primary": "var(--fg-primary)",
        "text-primary": "var(--text-primary)",
        "border-primary": "var(--border-primary)",

        /* Secondary colors */
        "bg-secondary": "var(--bg-secondary)",
        "bg-secondary_hover": "var(--bg-secondary_hover)",
        "bg-secondary_alt": "var(--bg-secondary_alt)",
        "bg-secondary_subtle": "var(--bg-secondary_subtle)",
        "bg-secondary-solid": "var(--bg-secondary-solid)",
        "fg-secondary": "var(--fg-secondary)",
        "text-secondary": "var(--text-secondary)",
        "text-secondary_hover": "var(--text-secondary_hover)",
        "border-secondary": "var(--border-secondary)",

        /* Tertiary colors */
        "bg-tertiary": "var(--bg-tertiary)",
        "fg-tertiary": "var(--fg-tertiary)",
        "text-tertiary": "var(--text-tertiary)",

        /* Quaternary colors */
        "bg-quaternary": "var(--bg-quaternary)",
        "fg-quaternary": "var(--fg-quaternary)",
        "text-quaternary": "var(--text-quaternary)",

        /* Brand colors */
        "bg-brand-primary": "var(--bg-brand-primary)",
        "bg-brand-primary-hover": "var(--bg-brand-primary-hover)",
        "fg-brand-primary": "var(--fg-brand-primary)",
        "fg-brand-primary-alt": "var(--fg-brand-primary-alt)",
        "border-brand-primary": "var(--border-brand-primary)",
        "bg-brand-secondary": "var(--bg-brand-secondary)",
        "bg-brand-secondary-hover": "var(--bg-brand-secondary-hover)",
        "fg-brand-secondary": "var(--fg-brand-secondary)",
        "fg-brand-secondary-alt": "var(--fg-brand-secondary-alt)",
        "border-brand-secondary": "var(--border-brand-secondary)",

        /* Warning colors */
        "bg-warning-primary": "var(--bg-warning-primary)",

        /* Error colors */
        "bg-error-primary": "var(--bg-error-primary)",
        "bg-error-secondary": "var(--bg-error-secondary)",
        "fg-error-primary": "var(--fg-error-primary)",
        "fg-error-secondary": "var(--fg-error-secondary)",
        "text-error-primary": "var(--text-error-primary)",
        "border-error": "var(--border-error)",

        /* Disabled colors */
        "bg-disabled": "var(--bg-disabled)",
        "fg-disabled": "var(--fg-disabled)",
        "text-disabled": "var(--text-disabled)",

        /* Other colors */
        "text-white": "var(--text-white)",
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

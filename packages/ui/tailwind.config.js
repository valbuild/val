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
      5: 5,
      50: 50,
      hover: 1,
      window: 2,
      full: 3,
      overlay: 4,
    },
    fontFamily: {
      sans: ["DM Sans", "sans-serif"],
      serif: ["Space Grotesk", "sans-serif"],
    },
    extend: {
      colors: {
        "bg-selection": "var(--bg-selection)",
        "text-selection": "var(--text-selection)",
        "bg-primary": "var(--bg-primary)",
        "bg-primary-hover": "var(--bg-primary-hover)",
        "fg-primary": "var(--fg-primary)",
        "fg-primary-alt": "var(--fg-primary-alt)",
        "border-primary": "var(--border-primary)",
        "bg-secondary": "var(--bg-secondary)",
        "bg-secondary-hover": "var(--bg-secondary-hover)",
        "fg-secondary": "var(--fg-secondary)",
        "fg-secondary-alt": "var(--fg-secondary-alt)",
        "border-secondary": "var(--border-secondary)",
        "bg-tertiary": "var(--bg-tertiary)",
        "fg-tertiary": "var(--fg-tertiary)",
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
        "bg-warning-primary": "var(--bg-warning-primary)",
        "bg-error-primary": "var(--bg-error-primary)",
        "bg-error-primary-hover": "var(--bg-error-primary-hover)",
        "fg-error-primary": "var(--fg-error-primary)",
        "fg-error-primary-alt": "var(--fg-error-primary-alt)",
        "border-error-primary": "var(--border-error-primary)",
        "bg-error-secondary": "var(--bg-error-secondary)",
        "bg-error-secondary-hover": "var(--bg-error-secondary-hover)",
        "fg-error-secondary": "var(--fg-error-secondary)",
        "fg-error-secondary-alt": "var(--fg-error-secondary-alt)",
        "border-error-secondary": "var(--border-error-secondary)",
        "bg-disabled": "var(--bg-disabled)",
        "fg-disabled": "var(--fg-disabled)",
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        ring: "hsl(var(--ring))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: 0,
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: 0,
          },
        },
        "rotate-clock": {
          from: {
            transform: "rotate(0deg)",
          },
          to: {
            transform: "rotate(360deg)",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "rotate-clock-hour-hand": "rotate-clock 12s linear infinite",
        "rotate-clock-minute-hand": "rotate-clock 1s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

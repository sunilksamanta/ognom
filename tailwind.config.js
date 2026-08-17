import animate from "tailwindcss-animate";

/**
 * Every colour is a theme-kit token. Opacity modifiers (`bg-primary/10`) are
 * honoured through color-mix so utilities keep working on top of raw hex/rgba
 * tokens without an HSL indirection.
 */
const tok = (name) => ({ opacityValue }) => {
  // Without a modifier Tailwind passes `var(--tw-*-opacity)`; treat as opaque.
  const n = Number(opacityValue);
  if (opacityValue === undefined || Number.isNaN(n) || n >= 1) return `var(${name})`;
  return `color-mix(in oklab, var(${name}) ${Math.round(n * 100)}%, transparent)`;
};

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // ---- raw tokens (preferred in new code) ----
        chrome: tok("--chrome"),
        bg: tok("--bg"),
        panel: tok("--panel"),
        "panel-2": tok("--panel-2"),
        raised: tok("--raised"),
        hover: tok("--hover"),
        active: tok("--active"),
        line: tok("--line"),
        "line-2": tok("--line-2"),
        text: tok("--text"),
        "text-2": tok("--text-2"),
        "text-3": tok("--text-3"),
        "accent-soft": tok("--accent-soft"),
        "accent-line": tok("--accent-line"),
        "accent-ink": tok("--accent-ink"),
        "accent-2": tok("--accent-2"),
        ok: tok("--ok"),
        warn: tok("--warn"),
        danger: tok("--danger"),
        // ---- semantic aliases (kept so existing components re-skin) ----
        border: tok("--line"),
        input: tok("--line-2"),
        ring: tok("--accent-line"),
        background: tok("--bg"),
        foreground: tok("--text"),
        primary: { DEFAULT: tok("--accent"), foreground: tok("--accent-ink") },
        secondary: { DEFAULT: tok("--panel-2"), foreground: tok("--text") },
        destructive: { DEFAULT: tok("--danger"), foreground: "#ffffff" },
        muted: { DEFAULT: tok("--panel-2"), foreground: tok("--text-2") },
        accent: { DEFAULT: tok("--hover"), foreground: tok("--text") },
        popover: { DEFAULT: tok("--raised"), foreground: tok("--text") },
        card: { DEFAULT: tok("--panel"), foreground: tok("--text") },
        warning: tok("--warn"),
        info: tok("--accent-2"),
        bson: {
          key: tok("--s-key"),
          string: tok("--s-str"),
          number: tok("--s-num"),
          boolean: tok("--s-bool"),
          null: tok("--s-punc"),
          oid: tok("--s-oid"),
          date: tok("--s-date"),
          punc: tok("--s-punc"),
        },
      },
      fontFamily: {
        sans: ["var(--sans)"],
        mono: ["var(--mono)"],
        display: ["var(--display)"],
      },
      borderRadius: {
        xs: "var(--r-xs)",
        sm: "var(--r-sm)",
        DEFAULT: "var(--r)",
        md: "var(--r-sm)",
        lg: "var(--r)",
        xl: "var(--r-lg)",
        "2xl": "var(--r-xl)",
      },
      boxShadow: {
        panel: "var(--shadow)",
      },
      transitionTimingFunction: {
        ease: "var(--ease)",
      },
    },
  },
  plugins: [animate],
};

import { createContext, useContext, useEffect, useState } from "react";

/** Theme ids from the theme kit. `auto` follows the OS. */
export const THEMES = [
  { id: "mongo-dark", name: "Mongo dark", tag: "default", dark: true, prev: ["#111413", "#161A18", "#00ED64"] },
  { id: "mongo-light", name: "Mongo light", tag: "", dark: false, prev: ["#F7FAF8", "#E9EFEB", "#00684A"] },
  { id: "bloom", name: "Bloom", tag: "floral", dark: false, prev: ["#FBF6F0", "#F1E6DC", "#B4527A"] },
  { id: "bloom-noir", name: "Bloom noir", tag: "floral", dark: true, prev: ["#1D141C", "#2B1E2C", "#F49AC1"] },
  { id: "midnight", name: "Midnight", tag: "", dark: true, prev: ["#101126", "#1B1E40", "#9B8CFF"] },
  { id: "mono", name: "Mono", tag: "", dark: true, prev: ["#151517", "#212125", "#E8E8EA"] },
  { id: "contrast", name: "Contrast", tag: "a11y", dark: true, prev: ["#000000", "#121212", "#3BFF88"] },
  { id: "solar", name: "Solar", tag: "", dark: false, prev: ["#FDF6E3", "#EFE6CD", "#B58900"] },
  { id: "auto", name: "Follow OS", tag: "auto", dark: true, prev: ["#111413", "#F7FAF8", "#00ED64"] },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export type Density = "compact" | "comfortable" | "roomy";
export const DENSITIES: { id: Density; label: string; hint: string }[] = [
  { id: "compact", label: "Compact", hint: "27px rows - most documents per screen" },
  { id: "comfortable", label: "Comfortable", hint: "34px rows - the default" },
  { id: "roomy", label: "Roomy", hint: "42px rows - presentations, large displays" },
];

type Resolved = "dark" | "light";

interface ThemeState {
  theme: ThemeId;
  density: Density;
  /** Whether the active theme paints a dark or light surface (drives Monaco). */
  resolved: Resolved;
  setTheme: (t: ThemeId) => void;
  setDensity: (d: Density) => void;
  cycleTheme: () => void;
}

const THEME_KEY = "ognom-theme";
const DENSITY_KEY = "ognom-density";

const ThemeCtx = createContext<ThemeState>({
  theme: "mongo-dark",
  density: "comfortable",
  resolved: "dark",
  setTheme: () => {},
  setDensity: () => {},
  cycleTheme: () => {},
});

const isTheme = (v: string | null): v is ThemeId => THEMES.some((t) => t.id === v);
const isDensity = (v: string | null): v is Density => DENSITIES.some((d) => d.id === v);
const osDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

function resolve(theme: ThemeId): Resolved {
  if (theme === "auto") return osDark() ? "dark" : "light";
  return THEMES.find((t) => t.id === theme)?.dark ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (isTheme(saved)) return saved;
    // Migrate the pre-2.0 light/dark preference.
    const legacy = localStorage.getItem("ognom-ui-theme");
    if (legacy === "light") return "mongo-light";
    if (legacy === "system") return "auto";
    return "mongo-dark";
  });
  const [density, setDensityState] = useState<Density>(() => {
    const saved = localStorage.getItem(DENSITY_KEY);
    return isDensity(saved) ? saved : "comfortable";
  });
  const [resolved, setResolved] = useState<Resolved>(() => resolve(theme));

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    const apply = () => {
      const r = resolve(theme);
      setResolved(r);
      root.classList.toggle("dark", r === "dark");
      root.classList.toggle("light", r === "light");
      root.style.colorScheme = r;
    };
    apply();
    if (theme !== "auto") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  const value: ThemeState = {
    theme,
    density,
    resolved,
    setTheme: (t) => {
      localStorage.setItem(THEME_KEY, t);
      setThemeState(t);
    },
    setDensity: (d) => {
      localStorage.setItem(DENSITY_KEY, d);
      setDensityState(d);
    },
    cycleTheme: () => {
      const idx = THEMES.findIndex((t) => t.id === theme);
      const next = THEMES[(idx + 1) % THEMES.length].id;
      localStorage.setItem(THEME_KEY, next);
      setThemeState(next);
    },
  };

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);

import { createContext, useContext, useEffect, useState } from "react"

type Theme = "dark" | "light" | "system"
type Resolved = "dark" | "light"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

type ThemeProviderState = {
  theme: Theme
  resolved: Resolved
  setTheme: (theme: Theme) => void
}

const initialState: ThemeProviderState = {
  theme: "system",
  resolved: "dark",
  setTheme: () => null,
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

const systemTheme = (): Resolved =>
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"

export function ThemeProvider({
  children,
  defaultTheme = "dark",
  storageKey = "ognom-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  )
  const [resolved, setResolved] = useState<Resolved>(() =>
    theme === "system" ? systemTheme() : theme
  )

  useEffect(() => {
    const root = window.document.documentElement
    const apply = (value: Resolved) => {
      root.classList.remove("light", "dark")
      root.classList.add(value)
      setResolved(value)
    }

    if (theme !== "system") {
      apply(theme)
      return
    }
    apply(systemTheme())
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => apply(systemTheme())
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [theme])

  const value = {
    theme,
    resolved,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme)
      setTheme(theme)
    },
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider")

  return context
}

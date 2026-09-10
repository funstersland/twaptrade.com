export const appearanceOptions: Record<string, readonly string[]> = {
  theme: ["dark", "light", "system"],
  accent: ["auto", "mint", "sky", "amber", "rose"],
  density: ["comfortable", "compact"],
  motion: ["full", "reduced"],
};

export type Preferences = {
  theme: string;
  accent: string;
  density: string;
  motion: string;
};

export const defaultPreferences: Preferences = {
  theme: "dark",
  accent: "auto",
  density: "comfortable",
  motion: "full",
};

export function validPreferences(value: unknown): Partial<Preferences> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, choice]) =>
        Object.hasOwn(appearanceOptions, key) &&
        typeof choice === "string" &&
        appearanceOptions[key].includes(choice),
    ),
  );
}

type StorageScope = "localStorage" | "sessionStorage";

// Storage can throw even when accessing the property in restricted browsers.
// Preferences still apply in memory when persistence is unavailable.
export function readBrowserStorage(
  scope: StorageScope,
  key: string,
): string | null {
  try {
    return typeof window === "undefined" ? null : window[scope].getItem(key);
  } catch {
    return null;
  }
}

export function writeBrowserStorage(
  scope: StorageScope,
  key: string,
  value: string,
): boolean {
  try {
    if (typeof window === "undefined") return false;
    window[scope].setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

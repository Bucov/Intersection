import { Color } from "three";

/**
 * Scene colours come from the same CSS tokens as the interface (index.css,
 * --scene-* and the semantic colours). Restyling the tokens restyles the 3D
 * scene; these hex values are only the fallback when CSS is unavailable.
 */
export interface SceneTheme {
  background: Color;
  base: Color;
  asphalt: Color;
  sidewalk: Color;
  curb: Color;
  marking: Color;
  planting: Color;
  foliage: Color;
  building: Color;
  signalHousing: Color;
  keyLight: Color;
  signalRed: Color;
  signalAmber: Color;
  signalGreen: Color;
  groupNS: Color;
  groupEW: Color;
  emergency: Color;
}

const FALLBACK: Record<keyof SceneTheme, string> = {
  background: "#0b0d10",
  base: "#14171b",
  asphalt: "#24272b",
  sidewalk: "#3e4146",
  curb: "#53575c",
  marking: "#e8e9ea",
  planting: "#2a3a2e",
  foliage: "#3f5a40",
  building: "#2e3136",
  signalHousing: "#15171a",
  keyLight: "#fff7ec",
  signalRed: "#e5483d",
  signalAmber: "#f2b53a",
  signalGreen: "#3fc47c",
  groupNS: "#6cc6e6",
  groupEW: "#b38be6",
  emergency: "#ec5468",
};

const VARIABLES: Record<keyof SceneTheme, string> = {
  background: "--scene-background",
  base: "--scene-base",
  asphalt: "--scene-asphalt",
  sidewalk: "--scene-sidewalk",
  curb: "--scene-curb",
  marking: "--scene-marking",
  planting: "--scene-planting",
  foliage: "--scene-foliage",
  building: "--scene-building",
  signalHousing: "--scene-signal-housing",
  keyLight: "--scene-key-light",
  signalRed: "--signal-red",
  signalAmber: "--signal-amber",
  signalGreen: "--signal-green",
  groupNS: "--group-ns",
  groupEW: "--group-ew",
  emergency: "--emergency",
};

let cached: SceneTheme | null = null;

/** Resolve any CSS colour (oklch included) to sRGB through a 1×1 canvas. */
function resolveCssColor(value: string, context: CanvasRenderingContext2D | null): string | null {
  if (!value || !context) return null;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = "#000";
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

export function readSceneTheme(): SceneTheme {
  if (cached) return cached;
  const theme = {} as SceneTheme;
  let context: CanvasRenderingContext2D | null = null;
  let styles: CSSStyleDeclaration | null = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    context = canvas.getContext("2d", { willReadFrequently: true });
    styles = getComputedStyle(document.documentElement);
  } catch {
    context = null;
  }
  for (const key of Object.keys(VARIABLES) as (keyof SceneTheme)[]) {
    const raw = styles?.getPropertyValue(VARIABLES[key]).trim() ?? "";
    const resolved = resolveCssColor(raw, context);
    // Colours from CSS are sRGB; Color.setStyle converts them to the working colour space.
    theme[key] = new Color().setStyle(resolved ?? FALLBACK[key]);
  }
  cached = theme;
  return theme;
}

/** Drop the cache after a theme change so the next mount re-reads the tokens. */
export function invalidateSceneTheme() {
  cached = null;
}

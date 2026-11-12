/**
 * Docket design tokens, the same values as the web app (`web/src/index.css`, `docs/DESIGN_BRIEF.md`).
 * Paper, ink and carbon-copy blue; PayPal states are rubber-stamp colours. Every text pair meets WCAG AA
 * (4.5:1) on its own background in both schemes.
 */
export interface Palette {
  scheme: "light" | "dark";
  paper: string;
  paper2: string;
  card: string;
  raised: string;
  ink: string;
  ink2: string;
  rule: string;
  input: string;
  carbon: string;
  carbonSoft: string;
  held: string;
  heldSoft: string;
  paid: string;
  paidSoft: string;
  stop: string;
  stopSoft: string;
  released: string;
  releasedSoft: string;
  onInk: string;
  shadow: string;
}

export const light: Palette = {
  scheme: "light",
  paper: "#F4EFE4",
  paper2: "#EBE4D4",
  card: "#FFFCF5",
  raised: "#FFFCF5",
  ink: "#1B1A16",
  ink2: "#5A564C",
  rule: "#D9D1BF",
  input: "#8F8672",
  carbon: "#2A3F8F",
  carbonSoft: "#E3E7F5",
  held: "#8A5300",
  heldSoft: "#F8EAD0",
  paid: "#1D6B3B",
  paidSoft: "#DCEFE1",
  stop: "#B0261C",
  stopSoft: "#F8E0DC",
  released: "#5A5F6B",
  releasedSoft: "#E6E7EA",
  onInk: "#FFFCF5",
  shadow: "rgba(27,26,22,0.14)",
};

export const dark: Palette = {
  scheme: "dark",
  paper: "#14130F",
  paper2: "#1A1914",
  card: "#1D1C17",
  raised: "#232219",
  ink: "#F2EDE1",
  ink2: "#B3AD9F",
  rule: "#34322A",
  input: "#77715E",
  carbon: "#9DB0F2",
  carbonSoft: "#1E2440",
  held: "#F0B45A",
  heldSoft: "#33270F",
  paid: "#7FCF98",
  paidSoft: "#12301C",
  stop: "#FF8A7A",
  stopSoft: "#3A1915",
  released: "#A9AFBC",
  releasedSoft: "#24262B",
  onInk: "#14130F",
  shadow: "rgba(0,0,0,0.5)",
};

export type Tone = "held" | "paid" | "stop" | "released" | "carbon" | "ink" | "quiet";

export function toneColors(p: Palette, tone: Tone): { fg: string; bg: string; dashed?: boolean } {
  switch (tone) {
    case "held":
      return { fg: p.held, bg: p.heldSoft };
    case "paid":
      return { fg: p.paid, bg: p.paidSoft };
    case "stop":
      return { fg: p.stop, bg: p.stopSoft };
    case "released":
      return { fg: p.released, bg: p.releasedSoft, dashed: true };
    case "carbon":
      return { fg: p.carbon, bg: p.carbonSoft };
    case "ink":
      return { fg: p.ink, bg: "transparent" };
    default:
      return { fg: p.ink2, bg: "transparent" };
  }
}

/** Font family names registered in the root layout. */
export const fonts = {
  display: "ArchivoExpanded-ExtraBold",
  displayBold: "ArchivoExpanded-Bold",
  heading: "Archivo_800ExtraBold",
  headingBold: "Archivo_700Bold",
  body: "SourceSans3_400Regular",
  bodySemi: "SourceSans3_600SemiBold",
  bodyBold: "SourceSans3_700Bold",
  mono: "Menlo",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 40 } as const;
export const radius = { sm: 4, md: 8, lg: 12, xl: 18 } as const;
/** Minimum touch target (Apple HIG 44 pt; WCAG 2.5.8 target size). */
export const TARGET = 44;

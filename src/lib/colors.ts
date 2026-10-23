// Earthy colours for the fixed categories (one each, in the fixed order) and flowers for people (by their place in the
// household). No data needed.
import { FIXED, type CategoryKey } from "./categories";

const FILLS = ["#7FB08C", "#E3A857", "#D98A7A", "#8AA6C9", "#B39BC8", "#C9B89A", "#E3A2B4", "#9DB36B", "#6FA8A8", "#D4A06A", "#A68F7B"];

/** `tint` is the fill at low opacity, for the soft badge behind an emoji. */
const COLORS = new Map(FIXED.map((c, i) => [c.key, { fill: FILLS[i], tint: `${FILLS[i]}38` }]));

const NO_CATEGORY = { fill: "#A9B5AA", tint: "#A9B5AA38" };

export function categoryColor(key: CategoryKey | null): { fill: string; tint: string } {
  return (key !== null && COLORS.get(key)) || NO_CATEGORY;
}

export type Flower = { petal: string; centre: string; shape: "round" | "oval" };

export const FLOWERS: ReadonlyArray<Flower> = [
  { petal: "#F2B25C", centre: "#8A5A2B", shape: "round" }, // sunflower
  { petal: "#F0A3B5", centre: "#C2577A", shape: "oval" }, // pink blossom
  { petal: "#B39BC8", centre: "#6E5A8A", shape: "round" }, // lavender
  { petal: "#8AA6C9", centre: "#4F6E96", shape: "oval" }, // sky
  { petal: "#D98A7A", centre: "#9C4F3F", shape: "round" }, // terracotta
  { petal: "#9DB36B", centre: "#5E7340", shape: "oval" }, // moss
  { petal: "#E3A2B4", centre: "#A4566C", shape: "round" }, // rose
  { petal: "#C9B89A", centre: "#7E6B4C", shape: "oval" }, // sand
];

export function flowerFor(index: number): Flower {
  return FLOWERS[((index % 8) + 8) % 8];
}

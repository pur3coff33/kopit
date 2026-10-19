// One-off: rasterize public/icons/icon.svg into the PNGs the manifest and iOS need.
// Run with `node scripts/make-icons.mjs`, then commit the PNGs.
import { readFile } from "node:fs/promises";
import sharp from "sharp";

const svg = await readFile(new URL("../public/icons/icon.svg", import.meta.url));
const out = (name) => new URL(`../public/icons/${name}`, import.meta.url).pathname.replace(/^\/(\w:)/, "$1");

for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  await sharp(svg, { density: 300 }).resize(size, size).png().toFile(out(name));
  console.log(`wrote ${name}`);
}

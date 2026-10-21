import { describe, expect, it } from "vitest";
import { categoryColor, flowerFor } from "../src/lib/colors";
import { Avatar, Plant, Wordmark } from "../src/views/garden";

const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("colours", () => {
  it("gives each category an earthy colour by id, and uncategorized a neutral one", () => {
    expect(categoryColor(1).fill).toBe("#E3A857");
    expect(categoryColor(8).fill).toBe("#7FB08C");
    expect(categoryColor(3).tint).toBe("#8AA6C938");
    expect(categoryColor(null).fill).toBe("#A9B5AA");
  });

  it("gives each person a flower by their place in the household", () => {
    expect(flowerFor(0).petal).toBe("#F2B25C");
    expect(flowerFor(9).petal).toBe("#F0A3B5");
  });
});

describe("drawings", () => {
  it("draws one leaf per no-spend day, up to 20", () => {
    expect(count(String(<Plant leaves={6} />), 'class="leaf"')).toBe(6);
    expect(count(String(<Plant leaves={35} />), 'class="leaf"')).toBe(20);
  });

  it("draws a sprout, never an empty pot", () => {
    const s = String(<Plant leaves={0} />);
    expect(s).toContain('class="sprout"');
    expect(s).not.toContain('class="leaf');
  });

  it("adds a bud while on track, a flower once bloomed, and marks the newest leaf", () => {
    expect(String(<Plant leaves={4} bud />)).toContain('class="bud"');
    expect(String(<Plant leaves={4} bloom />)).toContain('class="flower"');
    const s = String(<Plant leaves={3} newLeaf />);
    expect(count(s, 'class="leaf new"')).toBe(1);
    expect(count(s, 'class="leaf"')).toBe(2);
  });

  it("puts a small flower on the stem for each perfect day", () => {
    expect(count(String(<Plant leaves={6} perfect={2} />), 'class="pf"')).toBe(2);
    expect(count(String(<Plant leaves={3} perfect={0} />), 'class="pf"')).toBe(0);
  });

  it("tilts each leaf with a wrapping group, so a CSS transform-origin on the leaf can't throw it off the stem", () => {
    const s = String(<Plant leaves={3} newLeaf />);
    expect(count(s, '<g transform="rotate(')).toBe(3);
    expect(s).not.toMatch(/<ellipse class="leaf[^"]*"[^>]*transform=/);
  });

  it("flutters each leaf from where it meets the stem, on its own timing, with its flower riding along", () => {
    const s = String(<Plant leaves={4} perfect={4} />);
    const styles = [...s.matchAll(/<g class="flutter" style="([^"]*)">/g)].map((m) => m[1]);
    expect(styles).toHaveLength(4);
    for (const st of styles) expect(st).toMatch(/transform-origin:\d+(\.\d)?px \d+(\.\d)?px/);
    expect(new Set(styles.map((st) => st.match(/animation-delay:([^;]+)/)![1])).size).toBe(4);
    // Each perfect-day flower sits inside its leaf's flutter group, so it moves with the leaf.
    for (const part of s.split('<g class="flutter"').slice(1)) expect(part).toContain('class="pf"');
  });

  it("names the wordmark for screen readers and shows the person's flower", () => {
    expect(String(<Wordmark />)).toContain('aria-label="kop.it"');
    const a = String(<Avatar index={1} name="Mia" />);
    expect(a).toContain("#F0A3B5");
    expect(a).toContain(">M<");
  });
});

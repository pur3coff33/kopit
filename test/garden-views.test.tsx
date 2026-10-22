import { describe, expect, it } from "vitest";
import { categoryColor, flowerFor } from "../src/lib/colors";
import { Avatar, Plant, Wordmark } from "../src/views/garden";

const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("colours", () => {
  it("gives each category a colour by id, cycling through eight, and uncategorized one of its own", () => {
    const fills = Array.from({ length: 8 }, (_, i) => categoryColor(i).fill);
    expect(new Set(fills).size).toBe(8);
    expect(categoryColor(9)).toEqual(categoryColor(1));
    expect(fills).not.toContain(categoryColor(null).fill);
  });

  it("gives each person a flower by their place in the household, cycling through eight", () => {
    expect(flowerFor(9)).toEqual(flowerFor(1));
    expect(flowerFor(0)).not.toEqual(flowerFor(1));
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

  it("names the wordmark for screen readers and shows the person's flower", () => {
    expect(String(<Wordmark />)).toContain('aria-label="kop.it"');
    const a = String(<Avatar index={1} name="Mia" />);
    expect(a).toContain(flowerFor(1).petal);
    expect(a).toContain(">M<");
  });
});

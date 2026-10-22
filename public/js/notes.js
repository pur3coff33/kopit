// Note autocomplete. `notes` arrive most-used first: [{ note, categoryId, count }].

/**
 * Notes matching `query`, best first: notes that start with it, then notes with a word that
 * starts with it, then notes containing it anywhere. Ties keep the most-used-first order.
 */
export function suggest(notes, query, limit = 5) {
  const q = query.trim().toLowerCase();
  if (!q) return notes.slice(0, limit);
  const ranked = [];
  notes.forEach((n, i) => {
    const text = n.note.toLowerCase();
    const tier = text.startsWith(q) ? 0 : text.split(/\s+/).some((w) => w.startsWith(q)) ? 1 : text.includes(q) ? 2 : -1;
    if (tier >= 0) ranked.push({ n, tier, i });
  });
  return ranked
    .sort((a, b) => a.tier - b.tier || a.i - b.i)
    .slice(0, limit)
    .map((r) => r.n);
}

/**
 * What the category sheet offers for `categoryId`: the household's own notes used with it (most used first), then
 * that category's ready-made `presets` it hasn't used, ranked by `query` the same way as `suggest`.
 */
export function sheetNotes(own, categoryId, presets = [], query = "") {
  const seen = new Set();
  const list = [];
  const add = (note) => {
    if (seen.has(note.toLowerCase())) return;
    seen.add(note.toLowerCase());
    list.push({ note });
  };
  for (const n of own) if (n.categoryId === categoryId) add(n.note);
  for (const p of presets ?? []) add(p);
  return suggest(list, query, Infinity).map((n) => n.note);
}

/** The note box's suggestions: the household's own notes, then every category's presets it hasn't used. */
export function withPresets(own, presetsById) {
  const seen = new Set(own.map((n) => n.note.toLowerCase()));
  const out = [...own];
  for (const [id, presets] of Object.entries(presetsById)) {
    for (const note of presets) {
      if (seen.has(note.toLowerCase())) continue;
      seen.add(note.toLowerCase());
      out.push({ note, categoryId: Number(id), count: 0 });
    }
  }
  return out;
}

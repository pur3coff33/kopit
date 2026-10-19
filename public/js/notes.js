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

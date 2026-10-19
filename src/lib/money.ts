/** ₱1,000,000 — the largest single expense the app accepts. */
export const MAX_CENTAVOS = 100_000_000;

/** Parses a typed peso amount ("350", "350.5", "0.05") into centavos. */
export function parseAmount(input: string): number | null {
  const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(input);
  if (!m) return null;
  const centavos = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (centavos <= 0 || centavos > MAX_CENTAVOS) return null;
  return centavos;
}

export function formatPeso(centavos: number): string {
  const sign = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  const pesos = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = abs % 100;
  return `${sign}₱${pesos}${cents ? "." + String(cents).padStart(2, "0") : ""}`;
}

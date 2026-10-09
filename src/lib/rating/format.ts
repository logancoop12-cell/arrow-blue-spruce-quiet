export function formatPrice(value: number | null, currency: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: value >= 1000 ? 0 : 2,
      minimumFractionDigits: value >= 1000 ? 0 : 2,
    }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

export function formatCompact(value: number | null, currency: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return value.toFixed(0);
  }
}

export function formatChange(decimal: number | null): string {
  if (decimal == null || !Number.isFinite(decimal)) return "—";
  const pct = decimal * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export function formatWeight(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

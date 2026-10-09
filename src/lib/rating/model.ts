export const RATING_LABELS = [
  "Strong Sell",
  "Sell",
  "Hold",
  "Buy",
  "Strong Buy",
] as const;

export type RatingLabel = (typeof RATING_LABELS)[number];

export type FactorKey =
  | "peVsIndustry"
  | "peg"
  | "pbVsIndustry"
  | "netIncomeGrowth"
  | "forwardPeVsIndustry"
  | "shareholderYield"
  | "fcfYield";

/** Stated weights. They sum to 1. Missing factors are dropped and the rest rescaled. */
export const FACTORS: {
  key: FactorKey;
  label: string;
  weight: number;
  higherMeans: string;
}[] = [
  {
    key: "peVsIndustry",
    label: "P/E versus industry",
    weight: 0.25,
    higherMeans: "A lower trailing P/E than the industry median.",
  },
  {
    key: "peg",
    label: "PEG ratio",
    weight: 0.15,
    higherMeans: "A lower price/earnings-to-growth ratio.",
  },
  {
    key: "pbVsIndustry",
    label: "P/B versus industry",
    weight: 0.1,
    higherMeans: "A lower price-to-book than the industry median.",
  },
  {
    key: "netIncomeGrowth",
    label: "Net income growth",
    weight: 0.2,
    higherMeans: "Faster compound growth in annual net income over about five years.",
  },
  {
    key: "forwardPeVsIndustry",
    label: "Forward P/E versus industry",
    weight: 0.15,
    higherMeans: "A lower forward P/E than the industry median.",
  },
  {
    key: "shareholderYield",
    label: "Shareholder yield",
    weight: 0.05,
    higherMeans: "A higher dividend yield plus cash spent on buybacks.",
  },
  {
    key: "fcfYield",
    label: "Free cash flow yield",
    weight: 0.1,
    higherMeans: "A higher trailing free cash flow relative to market cap.",
  },
];

/**
 * Bands on the 0–100 composite. Edges are inclusive on the lower side of the
 * higher rating: 58 is Buy, 57 is Hold, 72 is Strong Buy, 33 is Strong Sell.
 */
export function ratingFor(score: number): RatingLabel {
  if (score >= 72) return "Strong Buy";
  if (score >= 58) return "Buy";
  if (score >= 46) return "Hold";
  if (score >= 34) return "Sell";
  return "Strong Sell";
}

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/**
 * Relative valuation. 0.50× the median scores 100, 1.00× scores 50, 1.50× scores 0.
 */
export function relativeMultipleScore(ratio: number): number {
  return clampScore((1.5 - ratio) * 100);
}

/**
 * PEG. 0.50 scores 100, 1.50 scores 50, 2.50 scores 0.
 */
export function pegScore(peg: number): number {
  return clampScore(((2.5 - peg) / 2) * 100);
}

/**
 * Net-income CAGR. −15% scores 0, +5% scores 50, +25% scores 100.
 */
export function growthScore(cagr: number): number {
  return clampScore(((cagr - -0.15) / 0.4) * 100);
}

/**
 * Shareholder yield as a decimal. 0% scores 35, 5% scores 100.
 * Dilution (negative yield) falls toward 0.
 */
export function shareholderYieldScore(yieldDecimal: number): number {
  return clampScore(35 + yieldDecimal * (65 / 0.05));
}

/**
 * FCF yield as a decimal. 0% scores 25, 8% scores 100.
 * Negative free cash flow scores below 25, hitting 0 at −8%.
 */
export function fcfYieldScore(yieldDecimal: number): number {
  if (yieldDecimal >= 0) return clampScore(25 + yieldDecimal * (75 / 0.08));
  return clampScore(25 + yieldDecimal * (25 / 0.08));
}

export type IncomePoint = { end: string; value: number };

export type IncomeWindow = {
  start: IncomePoint;
  end: IncomePoint;
  years: number;
  cagr: number | null;
  /** Both endpoints positive, so CAGR is defined. */
  profitable: boolean;
  /** Start was a loss and the latest year is a profit. */
  turnaround: boolean;
  /** Both endpoints are losses. */
  stillLosing: boolean;
  /** Losses shrank in absolute dollars. */
  lossesNarrowed: boolean;
};

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

export function pickIncomeWindow(points: IncomePoint[]): IncomeWindow | null {
  const sorted = [...points]
    .filter((p) => Number.isFinite(p.value) && !Number.isNaN(Date.parse(p.end)))
    .sort((a, b) => a.end.localeCompare(b.end));
  const deduped: IncomePoint[] = [];
  for (const point of sorted) {
    const last = deduped[deduped.length - 1];
    if (last && last.end === point.end) deduped[deduped.length - 1] = point;
    else deduped.push(point);
  }
  if (deduped.length < 2) return null;

  const end = deduped[deduped.length - 1]!;
  const endMs = Date.parse(end.end);
  let best: IncomePoint | null = null;
  let bestDist = Infinity;
  for (const point of deduped.slice(0, -1)) {
    const years = (endMs - Date.parse(point.end)) / YEAR_MS;
    if (years < 3.6 || years > 6.3) continue;
    const dist = Math.abs(years - 5);
    if (dist < bestDist) {
      bestDist = dist;
      best = point;
    }
  }
  if (!best) {
    const oldest = deduped[0]!;
    const years = (endMs - Date.parse(oldest.end)) / YEAR_MS;
    if (years < 2.4) return null;
    best = oldest;
  }
  const years = (endMs - Date.parse(best.end)) / YEAR_MS;
  const profitable = best.value > 0 && end.value > 0;
  const turnaround = best.value <= 0 && end.value > 0;
  const stillLosing = best.value <= 0 && end.value <= 0;
  const lossesNarrowed = stillLosing && Math.abs(end.value) < Math.abs(best.value);
  const cagr = profitable ? Math.pow(end.value / best.value, 1 / years) - 1 : null;
  return {
    start: best,
    end,
    years,
    cagr,
    profitable,
    turnaround,
    stillLosing,
    lossesNarrowed,
  };
}

export function incomePointsInWindow(points: IncomePoint[], window: IncomeWindow): IncomePoint[] {
  return [...points]
    .filter((p) => p.end >= window.start.end && p.end <= window.end.end)
    .sort((a, b) => a.end.localeCompare(b.end));
}

export type PeerSet = {
  label: string;
  /** industry = same industry; sector = same sector; market = large US stocks. */
  universe: "industry" | "sector" | "market";
  companyCount: number;
  trailingPEs: number[];
  forwardPEs: number[];
  priceToBooks: number[];
};

export type MarketSnapshot = {
  symbol: string;
  name: string;
  exchange: string | null;
  currency: string;
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  industry: string | null;
  sector: string | null;
  trailingPE: number | null;
  forwardPE: number | null;
  peg: number | null;
  priceToBook: number | null;
  dividendYield: number | null;
  /** Cash spent repurchasing stock. Positive number. */
  buybackCash: number | null;
  buybackPeriod: "trailing twelve months" | "latest fiscal year" | null;
  freeCashFlow: number | null;
  fcfPeriod: "trailing twelve months" | "latest fiscal year" | null;
  incomePoints: IncomePoint[] | null;
  incomeSource: string | null;
  /** Banks and insurers: reported free cash flow is not a shareholder yield. */
  fcfSkipped: boolean;
  peers: PeerSet | null;
};

export type FactorResult = {
  key: FactorKey;
  label: string;
  weight: number;
  effectiveWeight: number;
  score: number | null;
  reading: string;
  detail: string;
};

export type HistoryPoint = { year: string; value: number };

export type RatingReport = {
  symbol: string;
  name: string;
  exchange: string | null;
  currency: string;
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  industry: string | null;
  sector: string | null;
  score: number;
  rating: RatingLabel;
  coverage: number;
  factors: FactorResult[];
  incomeHistory: HistoryPoint[] | null;
  incomeSource: string | null;
  peerNote: string | null;
};

export type RateResult =
  | { ok: true; report: RatingReport }
  | { ok: false; message: string };

export function median(values: number[]): number | null {
  const clean = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  if (clean.length % 2) return clean[mid]!;
  return ((clean[mid - 1] ?? 0) + (clean[mid] ?? 0)) / 2;
}

export function fiscalYear(iso: string): string {
  const year = iso.slice(0, 4);
  return `FY${year.slice(2)}`;
}

function finiteOrNull(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return n;
}

type Draft = {
  key: FactorKey;
  label: string;
  weight: number;
  score: number | null;
  reading: string;
  detail: string;
};

function multipleFactor(args: {
  key: FactorKey;
  label: string;
  weight: number;
  multiple: number | null;
  multipleName: string;
  peerValues: number[];
  peerNoun: string;
}): Draft {
  const multiple = finiteOrNull(args.multiple);
  const peers = args.peerValues.filter((n) => n > 0 && n < 300);
  if (multiple == null) {
    return {
      key: args.key,
      label: args.label,
      weight: args.weight,
      score: null,
      reading: "Not reported",
      detail: `${args.multipleName} was not available, so this factor is left out and its weight is shared by the others.`,
    };
  }
  if (multiple <= 0) {
    return {
      key: args.key,
      label: args.label,
      weight: args.weight,
      score: 0,
      reading: "Negative",
      detail: `${args.multipleName} is negative, so there is no cheap-versus-expensive comparison to make. This factor scores at the floor.`,
    };
  }
  const mid = median(peers);
  if (mid == null || peers.length < 5) {
    return {
      key: args.key,
      label: args.label,
      weight: args.weight,
      score: null,
      reading: multiple.toFixed(1) + "×",
      detail: `Not enough peer ${args.multipleName} figures to build an industry median (need at least five). This factor is left out.`,
    };
  }
  const ratio = multiple / mid;
  const score = relativeMultipleScore(ratio);
  return {
    key: args.key,
    label: args.label,
    weight: args.weight,
    score,
    reading: `${multiple.toFixed(1)}× vs ${mid.toFixed(1)}×`,
    detail: `${args.multipleName} is ${multiple.toFixed(1)}×, which is ${ratio.toFixed(2)}× the ${mid.toFixed(1)}× median across ${peers.length} ${args.peerNoun}.`,
  };
}

export function assembleRating(snapshot: MarketSnapshot): RateResult {
  const peers = snapshot.peers;
  const peerNoun =
    peers == null
      ? "peers"
      : peers.universe === "market"
        ? `large US stocks`
        : `${peers.label} companies`;

  const drafts: Draft[] = [];

  drafts.push(
    multipleFactor({
      key: "peVsIndustry",
      label: "P/E versus industry",
      weight: 0.25,
      multiple: snapshot.trailingPE,
      multipleName: "Trailing P/E",
      peerValues: peers?.trailingPEs ?? [],
      peerNoun,
    }),
  );

  const peg = finiteOrNull(snapshot.peg);
  if (peg == null || peg > 40) {
    drafts.push({
      key: "peg",
      label: "PEG ratio",
      weight: 0.15,
      score: null,
      reading: "Not reported",
      detail:
        "PEG was not reported, so this factor is left out and its weight is shared by the others.",
    });
  } else if (peg <= 0) {
    drafts.push({
      key: "peg",
      label: "PEG ratio",
      weight: 0.15,
      score: 12,
      reading: "Negative",
      detail:
        "PEG is negative, which usually means earnings or expected growth are negative. That is treated as a weak reading, not a cheap one. A PEG of 0.50 would score 100, 1.50 would score 50, and 2.50 would score 0.",
    });
  } else {
    const score = pegScore(peg);
    drafts.push({
      key: "peg",
      label: "PEG ratio",
      weight: 0.15,
      score,
      reading: peg.toFixed(2),
      detail: `PEG is ${peg.toFixed(2)}.`,
    });
  }

  drafts.push(
    multipleFactor({
      key: "pbVsIndustry",
      label: "P/B versus industry",
      weight: 0.1,
      multiple: snapshot.priceToBook,
      multipleName: "Price-to-book",
      peerValues: peers?.priceToBooks ?? [],
      peerNoun,
    }),
  );

  const income = snapshot.incomePoints;
  const window = income ? pickIncomeWindow(income) : null;
  if (!window) {
    drafts.push({
      key: "netIncomeGrowth",
      label: "Net income growth",
      weight: 0.2,
      score: null,
      reading: "Not reported",
      detail:
        "Annual net income did not cover a long enough span to measure multi-year growth. This factor is left out.",
    });
  } else if (window.turnaround) {
    drafts.push({
      key: "netIncomeGrowth",
      label: "Net income growth",
      weight: 0.2,
      score: 82,
      reading: "Back to profit",
      detail: `Net income went from a loss in ${fiscalYear(window.start.end)} to a profit in ${fiscalYear(window.end.end)} over ${window.years.toFixed(1)} years. A compound rate is not defined from a loss, so the turnaround scores 82. Source: ${snapshot.incomeSource ?? "filings"}.`,
    });
  } else if (window.stillLosing) {
    const score = window.lossesNarrowed ? 42 : 12;
    drafts.push({
      key: "netIncomeGrowth",
      label: "Net income growth",
      weight: 0.2,
      score,
      reading: window.lossesNarrowed ? "Losses narrowed" : "Losses widened",
      detail: `Net income was still negative from ${fiscalYear(window.start.end)} to ${fiscalYear(window.end.end)}. ${window.lossesNarrowed ? "The loss got smaller, which scores 42." : "The loss got larger, which scores 12."} A normal growth rate is not used when both endpoints are losses.`,
    });
  } else if (window.start.value > 0 && window.end.value <= 0) {
    drafts.push({
      key: "netIncomeGrowth",
      label: "Net income growth",
      weight: 0.2,
      score: 0,
      reading: "Turned unprofitable",
      detail: `Net income went from a profit in ${fiscalYear(window.start.end)} to a loss in ${fiscalYear(window.end.end)}. This factor scores 0.`,
    });
  } else if (window.cagr != null) {
    const score = growthScore(window.cagr);
    drafts.push({
      key: "netIncomeGrowth",
      label: "Net income growth",
      weight: 0.2,
      score,
      reading: `${window.cagr >= 0 ? "+" : ""}${(window.cagr * 100).toFixed(1)}% / yr`,
      detail: `Net income compounded at ${(window.cagr * 100).toFixed(1)}% a year from ${fiscalYear(window.start.end)} to ${fiscalYear(window.end.end)}, a ${window.years.toFixed(1)}-year span. Source: ${snapshot.incomeSource ?? "filings"}.`,
    });
  } else {
    drafts.push({
      key: "netIncomeGrowth",
      label: "Net income growth",
      weight: 0.2,
      score: null,
      reading: "Not meaningful",
      detail: "Net income growth could not be measured from the reported figures. This factor is left out.",
    });
  }

  drafts.push(
    multipleFactor({
      key: "forwardPeVsIndustry",
      label: "Forward P/E versus industry",
      weight: 0.15,
      multiple: snapshot.forwardPE,
      multipleName: "Forward P/E",
      peerValues: peers?.forwardPEs ?? [],
      peerNoun,
    }),
  );

  const marketCap = finiteOrNull(snapshot.marketCap);
  const div = finiteOrNull(snapshot.dividendYield);
  const buybackCash = finiteOrNull(snapshot.buybackCash);
  let shareholder: number | null = null;
  let divPart = 0;
  let buybackPart: number | null = null;
  if (div != null && div >= 0 && div <= 0.25) divPart = div;
  else if (div != null && (div < 0 || div > 0.25)) divPart = 0;
  if (marketCap != null && marketCap > 0 && buybackCash != null) {
    buybackPart = buybackCash / marketCap;
    if (buybackPart > 0.4 || buybackPart < -0.2) buybackPart = null;
  }
  if (div != null || buybackPart != null) {
    shareholder = divPart + (buybackPart ?? 0);
  }
  if (shareholder == null) {
    drafts.push({
      key: "shareholderYield",
      label: "Shareholder yield",
      weight: 0.05,
      score: null,
      reading: "Not reported",
      detail:
        "Dividend yield and buybacks were not both measurable. This factor is left out.",
    });
  } else {
    const score = shareholderYieldScore(shareholder);
    const buybackText =
      buybackPart == null
        ? "Buybacks were not reported, so only the dividend is counted."
        : `Buybacks add ${(buybackPart * 100).toFixed(2)}% (${snapshot.buybackPeriod ?? "reported period"}).`;
    const dividendText =
      div != null && div >= 0 && div <= 0.25
        ? `Dividend yield is ${(divPart * 100).toFixed(2)}%.`
        : "Dividend yield was not reported and counts as zero.";
    drafts.push({
      key: "shareholderYield",
      label: "Shareholder yield",
      weight: 0.05,
      score,
      reading: `${(shareholder * 100).toFixed(2)}%`,
      detail: `${dividendText} ${buybackText} Together that is a ${(shareholder * 100).toFixed(2)}% shareholder yield.`,
    });
  }

  const fcf = finiteOrNull(snapshot.freeCashFlow);
  if (snapshot.fcfSkipped) {
    drafts.push({
      key: "fcfYield",
      label: "Free cash flow yield",
      weight: 0.1,
      score: null,
      reading: "Not used",
      detail:
        "Free cash flow is left out for banks and insurers. Their reported cash flow is mostly lending and investments, not cash the business can pay out. The other weights scale up to cover this 10%.",
    });
  } else if (fcf == null || marketCap == null || marketCap <= 0) {
    drafts.push({
      key: "fcfYield",
      label: "Free cash flow yield",
      weight: 0.1,
      score: null,
      reading: "Not reported",
      detail:
        "Trailing free cash flow or market cap was missing. This factor is left out. Banks and some financials often do not report free cash flow.",
    });
  } else {
    const y = fcf / marketCap;
    if (Math.abs(y) > 1.5) {
      drafts.push({
        key: "fcfYield",
        label: "Free cash flow yield",
        weight: 0.1,
        score: null,
        reading: "Not meaningful",
        detail:
          "Free cash flow versus market cap was too extreme to treat as a real yield. This factor is left out.",
      });
    } else {
      const score = fcfYieldScore(y);
      drafts.push({
        key: "fcfYield",
        label: "Free cash flow yield",
        weight: 0.1,
        score,
        reading: `${(y * 100).toFixed(2)}%`,
        detail: `Free cash flow (${snapshot.fcfPeriod ?? "reported"}) is a ${(y * 100).toFixed(2)}% yield on market cap.`,
      });
    }
  }

  const available = drafts.filter((d) => d.score != null);
  const weightSum = available.reduce((sum, d) => sum + d.weight, 0);
  if (weightSum <= 0) {
    return {
      ok: false,
      message: `Not enough reported fundamentals to rate ${snapshot.symbol}.`,
    };
  }

  const raw =
    available.reduce((sum, d) => sum + (d.score ?? 0) * d.weight, 0) / weightSum;
  const score = Math.round(raw);
  const factors: FactorResult[] = drafts.map((d) => ({
    key: d.key,
    label: d.label,
    weight: d.weight,
    effectiveWeight: d.score == null ? 0 : d.weight / weightSum,
    score: d.score == null ? null : Math.round(d.score),
    reading: d.reading,
    detail: d.detail,
  }));

  let incomeHistory: HistoryPoint[] | null = null;
  if (income && window) {
    incomeHistory = incomePointsInWindow(income, window).map((p) => ({
      year: fiscalYear(p.end),
      value: p.value,
    }));
  }

  let peerNote: string | null = null;
  if (peers) {
    if (peers.universe === "industry") {
      peerNote = `Industry medians use the largest ${peers.label} stocks with a positive multiple, excluding ${snapshot.symbol}.`;
    } else if (peers.universe === "sector") {
      peerNote = `The ${peers.label} industry did not have enough peers, so medians use the largest ${snapshot.sector ?? peers.label} sector stocks instead.`;
    } else {
      peerNote =
        "No usable industry peer set was found, so medians use large US stocks as a stand-in.";
    }
  }

  return {
    ok: true,
    report: {
      symbol: snapshot.symbol,
      name: snapshot.name,
      exchange: snapshot.exchange,
      currency: snapshot.currency || "USD",
      price: snapshot.price,
      changePercent: snapshot.changePercent,
      marketCap,
      industry: snapshot.industry,
      sector: snapshot.sector,
      score,
      rating: ratingFor(score),
      coverage: weightSum,
      factors,
      incomeHistory,
      incomeSource: snapshot.incomeSource,
      peerNote,
    },
  };
}

const EXCHANGE_SUFFIXES = new Set([
  "L",
  "TO",
  "V",
  "HK",
  "DE",
  "PA",
  "AS",
  "SW",
  "MI",
  "MC",
  "ST",
  "OL",
  "CO",
  "HE",
  "BR",
  "SA",
  "MX",
  "AX",
  "NZ",
  "SI",
  "KS",
  "KQ",
  "TW",
  "TWO",
  "T",
  "SS",
  "SZ",
  "IL",
  "IR",
]);

/** Accepts AAPL, $aapl, BRK.B. Keeps real exchange suffixes such as VOD.L. */
export function normalizeSymbol(input: string): string | null {
  let symbol = input.trim().toUpperCase().replace(/^\$/, "").replace(/\s+/g, "");
  if (!symbol || symbol.length > 15) return null;
  if (!/^[A-Z0-9][A-Z0-9.\-]*$/.test(symbol)) return null;
  const parts = symbol.split(".");
  if (parts.length === 2) {
    const suffix = parts[1] ?? "";
    if (!EXCHANGE_SUFFIXES.has(suffix) && suffix.length <= 2 && /^[A-Z]+$/.test(suffix)) {
      symbol = `${parts[0]}-${suffix}`;
    }
  }
  return symbol;
}

import { assembleRating, normalizeSymbol, type IncomePoint, type PeerSet, type RateResult } from "./model";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const SEC_UA = "Meridian research admin@meridian.app";

type Session = { cookie: string; crumb: string; at: number };

let session: Session | null = null;
let sessionPromise: Promise<Session> | null = null;

const reportCache = new Map<string, { at: number; result: RateResult }>();
const CACHE_MS = 10 * 60 * 1000;

let secMap: Map<string, string> | null = null;
let secMapPromise: Promise<Map<string, string>> | null = null;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const record = asRecord(value);
  if (!record) return null;
  const raw = record.raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  return null;
}

function str(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

async function getSession(force = false): Promise<Session> {
  if (!force && session && Date.now() - session.at < 20 * 60 * 1000) return session;
  if (!force && sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const fc = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": UA },
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
    });
    const cookies = typeof fc.headers.getSetCookie === "function" ? fc.headers.getSetCookie() : [];
    const cookie = cookies.map((item) => item.split(";")[0]).join("; ");
    if (!cookie) throw new Error("market session failed");
    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, Cookie: cookie },
      signal: AbortSignal.timeout(12000),
    });
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.includes("{") || crumb.includes("<")) {
      throw new Error("market session failed");
    }
    session = { cookie, crumb, at: Date.now() };
    return session;
  })().finally(() => {
    sessionPromise = null;
  });
  return sessionPromise;
}

async function yahooJson(url: string, init: RequestInit, retry = true): Promise<unknown> {
  const active = await getSession(!retry);
  const headers = new Headers(init.headers);
  headers.set("User-Agent", UA);
  headers.set("Cookie", active.cookie);
  const target = new URL(url);
  target.searchParams.set("crumb", active.crumb);
  const response = await fetch(target, {
    ...init,
    headers,
    signal: AbortSignal.timeout(14000),
  });
  if (response.status === 401 && retry) {
    session = null;
    return yahooJson(url, init, false);
  }
  if (!response.ok && response.status !== 404) throw new Error(`market data ${response.status}`);
  const text = await response.text();
  if (!text) {
    if (response.status === 404) return { quoteSummary: { error: { code: "Not Found" } } };
    throw new Error(`market data ${response.status}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    if (response.status === 404) return { quoteSummary: { error: { code: "Not Found" } } };
    throw new Error("market data was not readable");
  }
}

type QuoteCore = {
  symbol: string;
  name: string;
  exchange: string | null;
  currency: string;
  quoteType: string;
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  industry: string | null;
  sector: string | null;
  country: string | null;
  trailingPE: number | null;
  forwardPE: number | null;
  peg: number | null;
  priceToBook: number | null;
  dividendYield: number | null;
  dividendRate: number | null;
  freeCashFlow: number | null;
};

async function fetchQuote(symbol: string): Promise<QuoteCore | null> {
  const url = new URL(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`);
  url.searchParams.set(
    "modules",
    "price,assetProfile,summaryDetail,defaultKeyStatistics,financialData",
  );
  const payload = await yahooJson(url.toString(), { method: "GET" });
  const root = asRecord(asRecord(payload)?.quoteSummary);
  const error = asRecord(root?.error);
  if (error?.code === "Not Found") return null;
  const result = Array.isArray(root?.result) ? asRecord(root.result[0]) : null;
  if (!result) {
    const description = str(error?.description);
    if (description) return null;
    throw new Error("empty quote");
  }
  const price = asRecord(result.price);
  const profile = asRecord(result.assetProfile);
  const summary = asRecord(result.summaryDetail);
  const stats = asRecord(result.defaultKeyStatistics);
  const financial = asRecord(result.financialData);
  const quoteType = str(price?.quoteType) ?? "EQUITY";
  const dividendYield = num(summary?.dividendYield);
  const dividendRate = num(summary?.dividendRate);
  const px = num(price?.regularMarketPrice) ?? num(financial?.currentPrice);
  let yieldDecimal = dividendYield;
  if ((yieldDecimal == null || yieldDecimal <= 0) && dividendRate != null && px != null && px > 0) {
    yieldDecimal = dividendRate / px;
  }
  return {
    symbol,
    name: str(price?.longName) ?? str(price?.shortName) ?? symbol,
    exchange: str(price?.exchangeName),
    currency: str(price?.currency) ?? "USD",
    quoteType,
    price: px,
    changePercent: num(price?.regularMarketChangePercent),
    marketCap: num(summary?.marketCap) ?? num(price?.marketCap),
    industry: str(profile?.industry),
    sector: str(profile?.sector),
    country: str(profile?.country),
    trailingPE: num(summary?.trailingPE) ?? num(stats?.trailingPE),
    forwardPE: num(summary?.forwardPE) ?? num(stats?.forwardPE) ?? num(financial?.forwardPE),
    peg: num(stats?.pegRatio),
    priceToBook: num(stats?.priceToBook),
    dividendYield: yieldDecimal,
    dividendRate,
    freeCashFlow: num(financial?.freeCashflow),
  };
}

type SeriesBundle = {
  peg: number | null;
  freeCashFlow: number | null;
  fcfPeriod: "trailing twelve months" | "latest fiscal year" | null;
  buybackCash: number | null;
  buybackPeriod: "trailing twelve months" | "latest fiscal year" | null;
  annualIncome: IncomePoint[];
};

function readSeries(payload: unknown, type: string): { asOf: string; value: number }[] {
  const result = asRecord(asRecord(payload)?.timeseries)?.result;
  if (!Array.isArray(result)) return [];
  const rows: { asOf: string; value: number }[] = [];
  for (const entry of result) {
    const record = asRecord(entry);
    if (!record) continue;
    const metaType = asRecord(record.meta)?.type;
    const name = Array.isArray(metaType) ? metaType[0] : null;
    if (name !== type) continue;
    const points = record[type];
    if (!Array.isArray(points)) continue;
    for (const point of points) {
      const row = asRecord(point);
      const asOf = str(row?.asOfDate);
      const raw = num(row?.reportedValue);
      if (asOf && raw != null) rows.push({ asOf, value: raw });
    }
  }
  rows.sort((a, b) => a.asOf.localeCompare(b.asOf));
  return rows;
}

async function fetchSeries(symbol: string): Promise<SeriesBundle> {
  const empty: SeriesBundle = {
    peg: null,
    freeCashFlow: null,
    fcfPeriod: null,
    buybackCash: null,
    buybackPeriod: null,
    annualIncome: [],
  };
  try {
    const url = new URL(
      `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}`,
    );
    url.searchParams.set("symbol", symbol);
    url.searchParams.set(
      "type",
      [
        "annualNetIncome",
        "trailingFreeCashFlow",
        "annualFreeCashFlow",
        "trailingRepurchaseOfCapitalStock",
        "annualRepurchaseOfCapitalStock",
        "trailingPegRatio",
      ].join(","),
    );
    url.searchParams.set("period1", "1262304000");
    url.searchParams.set("period2", String(Math.floor(Date.now() / 1000) + 86400));
    const payload = await yahooJson(url.toString(), { method: "GET" });
    const pegRows = readSeries(payload, "trailingPegRatio");
    const fcfTtm = readSeries(payload, "trailingFreeCashFlow");
    const fcfAnnual = readSeries(payload, "annualFreeCashFlow");
    const buyTtm = readSeries(payload, "trailingRepurchaseOfCapitalStock");
    const buyAnnual = readSeries(payload, "annualRepurchaseOfCapitalStock");
    const income = readSeries(payload, "annualNetIncome");
    const latest = <T extends { value: number }>(rows: T[]): T | null =>
      rows.length ? rows[rows.length - 1]! : null;
    const buySource = latest(buyTtm) ?? latest(buyAnnual);
    const fcfSource = latest(fcfTtm) ?? latest(fcfAnnual);
    const cashOut = (value: number | null): number | null => {
      if (value == null) return null;
      // Quote feed stores cash spent on buybacks as a negative cash-flow figure.
      if (value < 0) return Math.abs(value);
      return value > 0 ? value : null;
    };
    return {
      peg: latest(pegRows)?.value ?? null,
      freeCashFlow: fcfSource?.value ?? null,
      fcfPeriod: latest(fcfTtm) ? "trailing twelve months" : latest(fcfAnnual) ? "latest fiscal year" : null,
      buybackCash: cashOut(buySource?.value ?? null),
      buybackPeriod: latest(buyTtm)
        ? "trailing twelve months"
        : latest(buyAnnual)
          ? "latest fiscal year"
          : null,
      annualIncome: income.map((row) => ({ end: row.asOf, value: row.value })),
    };
  } catch (error) {
    console.error("[meridian] series", error);
    return empty;
  }
}

type SlimQuote = {
  symbol: string;
  exchange: string | null;
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  priceToBook: number | null;
};

const US_LISTING_EXCHANGES = new Set(["NYQ", "NMS", "NGM", "NCM", "ASE"]);

function screenerIndustry(name: string): string {
  // The peer screen indexes "Beverages—Non-Alcoholic", while the quote says "Beverages - Non-Alcoholic".
  return name.replaceAll(" - ", "—");
}

function isPreferredShare(symbol: string): boolean {
  return /-[A-Z]{2,}$/.test(symbol);
}

async function screen(operands: { operator: string; operands: (string | number)[] }[]): Promise<SlimQuote[]> {
  const payload = await yahooJson("https://query1.finance.yahoo.com/v1/finance/screener", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      size: 100,
      offset: 0,
      sortField: "intradaymarketcap",
      sortType: "desc",
      quoteType: "EQUITY",
      query: { operator: "AND", operands },
    }),
  });
  const result = asRecord(asRecord(payload)?.finance)?.result;
  const first = Array.isArray(result) ? asRecord(result[0]) : null;
  const quotes = first?.quotes;
  if (!Array.isArray(quotes)) return [];
  const slim: SlimQuote[] = [];
  for (const quote of quotes) {
    const row = asRecord(quote);
    const symbol = str(row?.symbol);
    if (!symbol) continue;
    slim.push({
      symbol,
      exchange: str(row?.exchange),
      marketCap: num(row?.marketCap),
      trailingPE: num(row?.trailingPE),
      forwardPE: num(row?.forwardPE),
      priceToBook: num(row?.priceToBook),
    });
  }
  return slim;
}

function positiveCount(quotes: SlimQuote[], key: "trailingPE" | "forwardPE" | "priceToBook"): number {
  return quotes.filter((quote) => {
    const value = quote[key];
    return value != null && value > 0 && value < 300;
  }).length;
}

function selectPeers(quotes: SlimQuote[], symbol: string, usListed: boolean): SlimQuote[] {
  return quotes
    .filter((quote) => quote.symbol.toUpperCase() !== symbol.toUpperCase())
    .filter((quote) => !isPreferredShare(quote.symbol))
    .filter((quote) => quote.marketCap != null && quote.marketCap > 0)
    .filter((quote) => !usListed || (quote.exchange != null && US_LISTING_EXCHANGES.has(quote.exchange)))
    .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
    .slice(0, 40);
}

async function fetchPeers(
  industry: string | null,
  sector: string | null,
  symbol: string,
  usListed: boolean,
): Promise<PeerSet | null> {
  const region = usListed ? [{ operator: "EQ", operands: ["region", "us"] }] : [];
  try {
    let universe: PeerSet["universe"] = "industry";
    let label = industry ?? sector ?? "US large cap";
    let quotes: SlimQuote[] = [];
    if (industry) {
      const indexed = screenerIndustry(industry);
      quotes = selectPeers(
        await screen([...region, { operator: "EQ", operands: ["industry", indexed] }]),
        symbol,
        usListed,
      );
      if (positiveCount(quotes, "trailingPE") < 5 && indexed !== industry) {
        quotes = selectPeers(
          await screen([...region, { operator: "EQ", operands: ["industry", industry] }]),
          symbol,
          usListed,
        );
      }
      label = industry;
    }
    if (positiveCount(quotes, "trailingPE") < 5 && sector) {
      quotes = selectPeers(
        await screen([...region, { operator: "EQ", operands: ["sector", sector] }]),
        symbol,
        usListed,
      );
      universe = "sector";
      label = sector;
    }
    if (positiveCount(quotes, "trailingPE") < 5) {
      quotes = selectPeers(
        await screen([
          { operator: "EQ", operands: ["region", "us"] },
          { operator: "GT", operands: ["intradaymarketcap", 50_000_000_000] },
        ]),
        symbol,
        true,
      );
      universe = "market";
      label = "US large cap";
    }
    if (!quotes.length) return null;
    const take = (key: "trailingPE" | "forwardPE" | "priceToBook") =>
      quotes
        .map((quote) => quote[key])
        .filter((value): value is number => value != null && value > 0 && value < 300);
    return {
      label,
      universe,
      companyCount: quotes.length,
      trailingPEs: take("trailingPE"),
      forwardPEs: take("forwardPE"),
      priceToBooks: take("priceToBook"),
    };
  } catch (error) {
    console.error("[meridian] peers", error);
    return null;
  }
}

async function loadSecMap(): Promise<Map<string, string>> {
  if (secMap) return secMap;
  if (secMapPromise) return secMapPromise;
  secMapPromise = (async () => {
    const response = await fetch("https://www.sec.gov/files/company_tickers.json", {
      headers: { "User-Agent": SEC_UA, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`sec tickers ${response.status}`);
    const payload = (await response.json()) as unknown;
    const map = new Map<string, string>();
    const rows = Array.isArray(payload) ? payload : Object.values(asRecord(payload) ?? {});
    for (const row of rows) {
      const record = asRecord(row);
      const ticker = str(record?.ticker);
      const cik = record?.cik_str;
      if (!ticker || (typeof cik !== "number" && typeof cik !== "string")) continue;
      const padded = String(cik).padStart(10, "0");
      map.set(ticker.toUpperCase(), padded);
      map.set(ticker.toUpperCase().replace(".", "-"), padded);
      map.set(ticker.toUpperCase().replace("-", "."), padded);
    }
    secMap = map;
    return map;
  })().finally(() => {
    secMapPromise = null;
  });
  return secMapPromise;
}

async function fetchSecIncome(symbol: string): Promise<IncomePoint[] | null> {
  try {
    const map = await loadSecMap();
    const cik = map.get(symbol.toUpperCase());
    if (!cik) return null;
    const response = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: { "User-Agent": SEC_UA, Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`sec facts ${response.status}`);
    const payload = asRecord(await response.json());
    const gaap = asRecord(asRecord(payload?.facts)?.["us-gaap"]);
    const concept = asRecord(gaap?.NetIncomeLoss) ?? asRecord(gaap?.ProfitLoss);
    const units = asRecord(concept?.units);
    const usd = units?.USD;
    const list = Array.isArray(usd) ? usd : [];
    const candidates: { end: string; value: number; filed: string }[] = [];
    for (const item of list) {
      const row = asRecord(item);
      if (!row) continue;
      const form = str(row.form);
      if (form !== "10-K" && form !== "20-F" && form !== "40-F") continue;
      const fp = str(row.fp);
      if (fp && fp !== "FY") continue;
      const start = str(row.start);
      const end = str(row.end);
      const val = num(row.val);
      if (!start || !end || val == null) continue;
      const days = (Date.parse(end) - Date.parse(start)) / 86400000;
      if (!Number.isFinite(days) || days < 300 || days > 380) continue;
      candidates.push({ end, value: val, filed: str(row.filed) ?? "" });
    }
    const byEnd = new Map<string, { end: string; value: number; filed: string }>();
    for (const row of candidates) {
      const prev = byEnd.get(row.end);
      if (!prev || row.filed >= prev.filed) byEnd.set(row.end, row);
    }
    const points = [...byEnd.values()]
      .sort((a, b) => a.end.localeCompare(b.end))
      .map((row) => ({ end: row.end, value: row.value }));
    return points.length >= 2 ? points : null;
  } catch (error) {
    console.error("[meridian] sec", error);
    return null;
  }
}

function isUsListed(quote: QuoteCore): boolean {
  if (quote.country === "United States") return true;
  const exchange = quote.exchange ?? "";
  return /nasdaq|nyse|amex|nyse american/i.test(exchange);
}

function fcfIsMeaningful(industry: string | null, sector: string | null): boolean {
  const blob = `${industry ?? ""} ${sector ?? ""}`.toLowerCase();
  return !/bank|insurance|insurer/.test(blob);
}

function unsupportedMessage(symbol: string, quoteType: string): string {
  const kind = quoteType.replaceAll("_", " ").toLowerCase();
  return `${symbol} looks like ${kind === "etf" ? "an ETF" : `a ${kind}`}, not an operating company. Meridian rates common stocks.`;
}

export async function buildRating(rawSymbol: string): Promise<RateResult> {
  const symbol = normalizeSymbol(rawSymbol);
  if (!symbol) {
    return {
      ok: false,
      message: "Enter a ticker like AAPL or BRK-B.",
    };
  }
  const cached = reportCache.get(symbol);
  if (cached && Date.now() - cached.at < (cached.result.ok ? CACHE_MS : 20_000)) {
    return cached.result;
  }
  try {
    const secPromise = fetchSecIncome(symbol);
    const [quote, series] = await Promise.all([fetchQuote(symbol), fetchSeries(symbol)]);
    if (!quote) {
      const result: RateResult = {
        ok: false,
        message: `No listing found for ${symbol}. Check the ticker. Class shares use a dash, like BRK-B.`,
      };
      reportCache.set(symbol, { at: Date.now(), result });
      return result;
    }
    if (quote.quoteType !== "EQUITY") {
      const result: RateResult = { ok: false, message: unsupportedMessage(symbol, quote.quoteType) };
      reportCache.set(symbol, { at: Date.now(), result });
      return result;
    }
    const [peers, secIncome] = await Promise.all([
      fetchPeers(quote.industry, quote.sector, symbol, isUsListed(quote)),
      secPromise,
    ]);
    const incomePoints = secIncome && secIncome.length >= 2 ? secIncome : series.annualIncome;
    const incomeSource =
      secIncome && secIncome.length >= 2
        ? "annual SEC filings"
        : series.annualIncome.length >= 2
          ? "annual figures from the quote feed"
          : null;
    const peg = quote.peg != null ? quote.peg : series.peg;
    const skipFcf = !fcfIsMeaningful(quote.industry, quote.sector);
    const freeCashFlow = skipFcf ? null : (series.freeCashFlow ?? quote.freeCashFlow);
    const fcfPeriod = skipFcf
      ? null
      : series.freeCashFlow != null
        ? series.fcfPeriod
        : quote.freeCashFlow != null
          ? "trailing twelve months"
          : null;
    const result = assembleRating({
      symbol: quote.symbol,
      name: quote.name,
      exchange: quote.exchange,
      currency: quote.currency,
      price: quote.price,
      changePercent: quote.changePercent,
      marketCap: quote.marketCap,
      industry: quote.industry,
      sector: quote.sector,
      trailingPE: quote.trailingPE,
      forwardPE: quote.forwardPE,
      peg,
      priceToBook: quote.priceToBook,
      dividendYield: quote.dividendYield,
      buybackCash: series.buybackCash,
      buybackPeriod: series.buybackPeriod,
      freeCashFlow,
      fcfPeriod,
      fcfSkipped: skipFcf,
      incomePoints: incomePoints.length ? incomePoints : null,
      incomeSource,
      peers,
    });
    reportCache.set(symbol, { at: Date.now(), result });
    return result;
  } catch (error) {
    console.error("[meridian] rate", error);
    return {
      ok: false,
      message: "The market data feed didn't respond. Try that ticker again in a moment.",
    };
  }
}

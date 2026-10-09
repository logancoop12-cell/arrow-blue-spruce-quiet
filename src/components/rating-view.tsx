import { useEffect, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { formatChange, formatCompact, formatPrice, formatWeight } from "@/lib/rating/format";
import { FACTORS, normalizeSymbol, type RatingLabel, type RatingReport, type RateResult } from "@/lib/rating/model";

const EXAMPLES = ["AAPL", "MSFT", "NVDA", "JPM", "KO", "XOM", "UNH", "CAT"];
const RECENT_KEY = "meridian.recent";

function ratingTone(rating: RatingLabel): string {
  if (rating === "Strong Buy" || rating === "Buy") return "text-buy";
  if (rating === "Strong Sell" || rating === "Sell") return "text-sell";
  return "text-fg";
}

function readRecent(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string").slice(0, 8);
  } catch {
    return [];
  }
}

function remember(symbol: string) {
  const next = [symbol, ...readRecent().filter((item) => item !== symbol)].slice(0, 8);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

export function RatingView({
  ticker,
  result,
  onRate,
}: {
  ticker: string;
  result: RateResult | null;
  onRate: (symbol: string) => void;
}) {
  const [draft, setDraft] = useState(ticker);
  const [recent, setRecent] = useState<string[]>([]);
  const isLoading = useRouterState({ select: (state) => state.isLoading });
  const router = useRouter();

  useEffect(() => {
    setDraft(ticker);
  }, [ticker]);

  useEffect(() => {
    setRecent(readRecent());
  }, []);

  useEffect(() => {
    if (!result?.ok) return;
    remember(result.report.symbol);
    setRecent(readRecent());
  }, [result]);

  const activeSymbol = normalizeSymbol(ticker);
  const report =
    result?.ok && activeSymbol && result.report.symbol === activeSymbol ? result.report : null;
  const error = result && !result.ok && !isLoading ? result.message : null;
  const showPending = isLoading && ticker.trim().length > 0;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-3">
        <p className="text-xs font-medium tracking-widest text-subtle uppercase">Stock rating</p>
        <h1 className="font-display text-5xl leading-none font-medium tracking-tight text-fg">Meridian</h1>
        <p className="max-w-xl text-base text-muted">
          Enter a ticker. The rating is Strong Sell, Sell, Hold, Buy, or Strong Buy, from seven
          fundamentals with fixed weights.
        </p>
      </header>

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const next = draft.trim();
          if (!next) return;
          if (normalizeSymbol(next) && normalizeSymbol(next) === activeSymbol) {
            void router.invalidate();
            return;
          }
          onRate(next);
        }}
      >
        <label htmlFor="ticker" className="text-sm font-medium text-fg">
          Ticker
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="ticker"
            name="ticker"
            value={draft}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="AAPL"
            onChange={(event) => setDraft(event.target.value)}
            className="h-11 w-full rounded-sm border border-line bg-surface px-3 text-base text-fg tabular-nums placeholder:text-subtle"
          />
          <button
            type="submit"
            className="pressable inline-flex h-11 items-center justify-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-accent-fg sm:min-w-28"
          >
            <Search className="size-4" aria-hidden="true" />
            Rate
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((symbol) => (
            <button
              key={symbol}
              type="button"
              onClick={() => onRate(symbol)}
              className="pressable h-11 rounded-sm border border-line bg-surface px-3 text-sm text-muted tabular-nums hover:bg-raised hover:text-fg"
            >
              {symbol}
            </button>
          ))}
        </div>
        {recent.length > 0 ? (
          <p className="text-sm text-subtle">
            Recent:{" "}
            {recent.map((symbol, index) => (
              <span key={symbol}>
                {index > 0 ? ", " : null}
                <button
                  type="button"
                  onClick={() => onRate(symbol)}
                  className="pressable text-muted underline decoration-line underline-offset-4 hover:text-fg"
                >
                  {symbol}
                </button>
              </span>
            ))}
          </p>
        ) : null}
      </form>

      {showPending ? (
        <p className="text-sm text-muted" role="status">
          Pulling price, filings, and peer multiples for {draft.trim().toUpperCase() || ticker}…
        </p>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-line bg-surface p-5 text-sm text-fg" role="alert">
          {error}
        </p>
      ) : null}

      {report ? <Report report={report} /> : null}

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-2xl font-medium tracking-tight">How the weight is split</h2>
        <p className="text-sm text-muted">
          Each factor scores from 0 to 100. The rating is the weighted average. If a figure is
          missing, that factor drops out and the other weights scale up to 100%.
        </p>
        <ul className="overflow-hidden rounded-xl border border-line bg-surface">
          {FACTORS.map((factor) => (
            <li
              key={factor.key}
              className="flex flex-col gap-1 border-b border-line px-4 py-3 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg">{factor.label}</p>
                <p className="text-sm text-muted">{factor.higherMeans}</p>
              </div>
              <p className="text-sm font-medium text-fg tabular-nums sm:shrink-0">
                {formatWeight(factor.weight)}
              </p>
            </li>
          ))}
        </ul>
        <details className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">
          <summary className="cursor-pointer font-medium text-fg">How a number becomes a rating</summary>
          <div className="mt-3 flex flex-col gap-3">
            <p>
              Trailing P/E, forward P/E, and price-to-book are scored against the median of the
              largest peers. Half the median scores 100, in line with the median scores 50, and one
              and a half times the median scores 0. Negative earnings or book value score 0 on that
              factor.
            </p>
            <p>
              PEG of 0.50 scores 100, 1.50 scores 50, and 2.50 scores 0. A negative PEG scores 12,
              because it usually means earnings or expected growth are negative rather than cheap.
            </p>
            <p>
              Net income growth is the compound annual rate from annual filings, aimed at a
              five-year span. −15% a year scores 0, +5% scores 50, and +25% scores 100. A swing from
              profit to loss scores 0. A swing from loss to profit scores 82.
            </p>
            <p>
              Shareholder yield is the indicated dividend yield plus cash buybacks divided by market
              cap. 0% scores 35 and 5% scores 100. Free cash flow yield is trailing free cash flow
              divided by market cap. 0% scores 25, 8% scores 100, and −8% scores 0.
            </p>
            <p className="text-fg">
              72 and above is Strong Buy. 58 is Buy. 46 is Hold. 34 is Sell. Below 34 is Strong
              Sell.
            </p>
          </div>
        </details>
      </section>

      <footer className="text-sm text-subtle">
        Not investment advice. Prices and fundamentals come from public quote feeds and, for US
        filers, SEC annual reports. Figures can be missing, restated, or delayed.
      </footer>
    </main>
  );
}

function Report({ report }: { report: RatingReport }) {
  const renorm = report.coverage < 0.995;
  return (
    <section className="flex flex-col gap-4" aria-live="polite">
      <div className="rounded-xl border border-line bg-surface p-5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium tracking-wide text-subtle tabular-nums">
                {report.symbol}
                {report.exchange ? ` · ${report.exchange}` : ""}
              </p>
              <h2 className="font-display text-3xl leading-tight font-medium tracking-tight">
                {report.name}
              </h2>
            </div>
            <p className="text-sm text-muted">
              {[report.industry, report.sector].filter(Boolean).join(" · ") || "Industry unavailable"}
            </p>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="text-2xl font-medium tabular-nums">{formatPrice(report.price, report.currency)}</p>
            <p
              className={`text-sm font-medium tabular-nums ${
                report.changePercent == null
                  ? "text-muted"
                  : report.changePercent >= 0
                    ? "text-buy"
                    : "text-sell"
              }`}
            >
              {formatChange(report.changePercent)}
            </p>
            <p className="text-sm text-muted tabular-nums">
              Mkt cap {formatCompact(report.marketCap, report.currency)}
            </p>
          </div>
          <div className="flex flex-col gap-3 pt-2">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <p className={`font-display text-5xl leading-none font-medium ${ratingTone(report.rating)}`}>
                {report.rating}
              </p>
              <p className="text-sm text-muted tabular-nums">{report.score} / 100</p>
            </div>
            <div
              className="relative h-1 rounded-full bg-raised"
              role="img"
              aria-label={`${report.rating}, score ${report.score} out of 100`}
            >
              <div className="absolute inset-y-0 left-0 rounded-full bg-fg" style={{ width: `${report.score}%` }} />
              <div
                className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full bg-fg"
                style={{ left: `clamp(0px, calc(${report.score}% - 6px), calc(100% - 12px))` }}
              />
            </div>
            <p className="text-xs text-subtle">
              Strong Sell below 34 · Sell below 46 · Hold below 58 · Buy below 72 · Strong Buy from 72
            </p>
            {renorm ? (
              <p className="text-sm text-muted">
                Only {formatWeight(report.coverage)} of the model had data. The rating uses the
                factors that were available, scaled back to 100%.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface">
        <ul>
          {report.factors.map((factor) => (
            <li key={factor.key} className="border-b border-line px-4 py-4 last:border-b-0 sm:px-5">
              <div className="flex items-baseline justify-between gap-4">
                <p className="text-sm font-medium text-fg">{factor.label}</p>
                <p className="shrink-0 text-sm text-muted tabular-nums">
                  {formatWeight(factor.weight)}
                  {renorm && factor.score != null ? ` · counts as ${formatWeight(factor.effectiveWeight)}` : ""}
                </p>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-4">
                <p className="text-sm text-muted">{factor.reading}</p>
                <p className="text-sm font-medium text-fg tabular-nums">
                  {factor.score == null ? "—" : factor.score}
                </p>
              </div>
              {factor.score != null ? (
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-raised">
                  <div className="h-full bg-fg" style={{ width: `${factor.score}%` }} />
                </div>
              ) : null}
              <p className="mt-3 text-sm text-muted">{factor.detail}</p>
              {factor.key === "netIncomeGrowth" && report.incomeHistory && report.incomeHistory.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {report.incomeHistory.map((point) => (
                    <li key={point.year} className="rounded-sm bg-raised px-2 py-1 text-xs text-fg tabular-nums">
                      <span className="text-subtle">{point.year} </span>
                      {formatCompact(point.value, report.currency)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      {report.peerNote ? <p className="text-sm text-subtle">{report.peerNote}</p> : null}
    </section>
  );
}

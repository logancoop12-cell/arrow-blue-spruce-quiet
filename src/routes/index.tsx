import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RatingView } from "@/components/rating-view";
import type { RateResult } from "@/lib/rating/model";
import { rateTicker } from "@/lib/rating/rate";

type Search = { t: string };

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    t: typeof search.t === "string" ? search.t.slice(0, 16) : "",
  }),
  loaderDeps: ({ search }) => ({ t: search.t }),
  loader: async ({ deps }): Promise<RateResult | null> => {
    if (!deps.t.trim()) return null;
    return rateTicker({ data: { symbol: deps.t } });
  },
  component: Home,
});

function Home() {
  const search = Route.useSearch();
  const result = Route.useLoaderData();
  const navigate = useNavigate({ from: "/" });

  return (
    <RatingView
      ticker={search.t}
      result={result}
      onRate={(symbol) => {
        void navigate({ to: "/", search: { t: symbol } });
      }}
    />
  );
}

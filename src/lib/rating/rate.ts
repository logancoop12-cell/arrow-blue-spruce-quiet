import { createServerFn } from "@tanstack/react-start";
import type { RateResult } from "./model";

export const rateTicker = createServerFn({ method: "GET" })
  .validator((data: unknown) => {
    const record = data && typeof data === "object" ? (data as { symbol?: unknown }) : {};
    const symbol = typeof record.symbol === "string" ? record.symbol : "";
    return { symbol };
  })
  .handler(async ({ data }): Promise<RateResult> => {
    const { buildRating } = await import("./build.server");
    return buildRating(data.symbol);
  });

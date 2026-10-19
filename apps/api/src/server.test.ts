import { describe, it, expect } from "vitest";
import { buildServer } from "./server.js";

describe("read-model API", () => {
  const app = buildServer();

  it("GET /health", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("GET /api/mm returns a summary list", async () => {
    const res = await app.inject({ method: "GET", url: "/api/mm" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ handle: string; completed: number }>;
    expect(body.length).toBeGreaterThan(0);
    const vega = body.find((p) => p.handle === "vega-mm");
    expect(vega?.completed).toBe(6);
  });

  it("GET /api/mm/:handle returns the full profile", async () => {
    const res = await app.inject({ method: "GET", url: "/api/mm/vega-mm" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { displayName: string; engagements: unknown[] };
    expect(body.displayName).toBe("Vega Market Making");
    expect(body.engagements.length).toBe(5);
  });

  it("GET /api/mm/:handle/epochs returns the series", async () => {
    const res = await app.inject({ method: "GET", url: "/api/mm/vega-mm/epochs" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as unknown[]).length).toBe(12);
  });

  it("404s an unknown handle", async () => {
    const res = await app.inject({ method: "GET", url: "/api/mm/nope" });
    expect(res.statusCode).toBe(404);
  });
});

import { describe, it, expect } from "vitest";
import { PinataTreePublisher, PinataPublishError } from "./pinata.js";
import type { FetchLike } from "./http.js";

const JWT = "test.jwt.token";
const CIDV1 = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const CIDV0 = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";

function okUpload(cid: string): Response {
  return new Response(JSON.stringify({ data: { cid, size: 1536 } }), { status: 200 });
}

/** A fake transport that records each request and mints a fresh response per call. */
function recordingFetch(
  makeResponse: () => Response,
): { fetch: FetchLike; calls: { url: string; init: RequestInit | undefined }[] } {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return makeResponse();
  };
  return { fetch, calls };
}

describe("PinataTreePublisher.publish", () => {
  it("POSTs multipart to the v3 files endpoint with bearer auth and returns the cid", async () => {
    const { fetch, calls } = recordingFetch(() => okUpload(CIDV1));
    const pub = new PinataTreePublisher({ jwt: JWT, fetchImpl: fetch });

    const cid = await pub.publish(new Uint8Array([1, 2, 3]));

    expect(cid).toBe(CIDV1);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe("https://uploads.pinata.cloud/v3/files");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${JWT}`);
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect(form.get("network")).toBe("public");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("accepts a CIDv0 body", async () => {
    const { fetch } = recordingFetch(() => okUpload(CIDV0));
    const pub = new PinataTreePublisher({ jwt: JWT, fetchImpl: fetch });
    expect(await pub.publish(new Uint8Array([9]))).toBe(CIDV0);
  });

  it("identical bytes produce a request that yields the same cid (content-addressed)", async () => {
    const { fetch } = recordingFetch(() => okUpload(CIDV1));
    const pub = new PinataTreePublisher({ jwt: JWT, fetchImpl: fetch });
    const a = await pub.publish(new Uint8Array([1, 2, 3]));
    const b = await pub.publish(new Uint8Array([1, 2, 3]));
    expect(a).toBe(b);
  });

  it("refuses empty bytes before any request", async () => {
    const { fetch, calls } = recordingFetch(() => okUpload(CIDV1));
    const pub = new PinataTreePublisher({ jwt: JWT, fetchImpl: fetch });
    await expect(pub.publish(new Uint8Array())).rejects.toBeInstanceOf(PinataPublishError);
    expect(calls).toHaveLength(0);
  });

  it("throws a typed error with status + body on a non-2xx response", async () => {
    const { fetch } = recordingFetch(() => new Response("quota exceeded", { status: 403 }));
    const pub = new PinataTreePublisher({ jwt: JWT, fetchImpl: fetch });
    await expect(pub.publish(new Uint8Array([1]))).rejects.toMatchObject({
      name: "PinataPublishError",
      status: 403,
      body: "quota exceeded",
    });
  });

  it("rejects a 200 body that carries no valid cid (no silent fallback)", async () => {
    const { fetch } = recordingFetch(() => new Response(JSON.stringify({ data: {} }), { status: 200 }));
    const pub = new PinataTreePublisher({ jwt: JWT, fetchImpl: fetch });
    await expect(pub.publish(new Uint8Array([1]))).rejects.toThrow(/missing a valid cid/);
  });

  it("rejects a malformed (non-CID) cid value", async () => {
    const { fetch } = recordingFetch(() => new Response(JSON.stringify({ data: { cid: "not-a-cid" } }), { status: 200 }));
    const pub = new PinataTreePublisher({ jwt: JWT, fetchImpl: fetch });
    await expect(pub.publish(new Uint8Array([1]))).rejects.toThrow(/missing a valid cid/);
  });

  it("rejects a non-JSON 200 body", async () => {
    const { fetch } = recordingFetch(() => new Response("<html>oops</html>", { status: 200 }));
    const pub = new PinataTreePublisher({ jwt: JWT, fetchImpl: fetch });
    await expect(pub.publish(new Uint8Array([1]))).rejects.toThrow(/not JSON/);
  });
});

describe("PinataTreePublisher construction", () => {
  it("throws when the JWT is missing", () => {
    expect(() => new PinataTreePublisher({ jwt: "" })).toThrow(PinataPublishError);
  });

  it("fromEnv throws when PINATA_JWT is unset", () => {
    expect(() => PinataTreePublisher.fromEnv({})).toThrow(/PINATA_JWT/);
  });

  it("fromEnv reads the JWT and optional gateway", async () => {
    const pub = PinataTreePublisher.fromEnv({ PINATA_JWT: JWT, PINATA_GATEWAY: "https://g.mypinata.cloud" });
    expect(pub).toBeInstanceOf(PinataTreePublisher);
  });
});

describe("PinataTreePublisher.retrieve", () => {
  it("round-trips bytes back from the gateway for a published cid", async () => {
    const payload = new Uint8Array([4, 5, 6, 7]);
    const { fetch, calls } = recordingFetch(() => new Response(payload, { status: 200 }));
    const pub = new PinataTreePublisher({ jwt: JWT, gatewayUrl: "https://g.mypinata.cloud/", fetchImpl: fetch });

    const got = await pub.retrieve(CIDV1);

    expect(Array.from(got)).toEqual(Array.from(payload));
    expect(calls[0]!.url).toBe(`https://g.mypinata.cloud/ipfs/${CIDV1}`);
  });

  it("requires a configured gateway", async () => {
    const { fetch } = recordingFetch(() => new Response("", { status: 200 }));
    const pub = new PinataTreePublisher({ jwt: JWT, fetchImpl: fetch });
    await expect(pub.retrieve(CIDV1)).rejects.toThrow(/gatewayUrl is required/);
  });

  it("rejects a malformed cid before fetching", async () => {
    const { fetch, calls } = recordingFetch(() => new Response("", { status: 200 }));
    const pub = new PinataTreePublisher({ jwt: JWT, gatewayUrl: "https://g.mypinata.cloud", fetchImpl: fetch });
    await expect(pub.retrieve("nope")).rejects.toThrow(/not a CID/);
    expect(calls).toHaveLength(0);
  });
});

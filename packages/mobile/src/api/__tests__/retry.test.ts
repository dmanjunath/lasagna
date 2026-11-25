import { ApiError, request, retryDelay, shouldRetry } from "../client";

test("a dropped connection or server error retries up to three more times", () => {
  expect(shouldRetry(0, new ApiError("x", 0))).toBe(true);
  expect(shouldRetry(2, new ApiError("x", 503))).toBe(true);
  expect(shouldRetry(3, new ApiError("x", 0))).toBe(false);
});

test("a request the server refused never retries", () => {
  expect(shouldRetry(0, new ApiError("x", 400))).toBe(false);
  expect(shouldRetry(0, new ApiError("x", 404))).toBe(false);
});

test("the delay grows between tries", () => {
  expect([0, 1, 2, 5].map(retryDelay)).toEqual([400, 1200, 2400, 2400]);
});

describe("request", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("a stale connection is retried once on a fresh one", async () => {
    const ok = { ok: true, status: 200, json: async () => ({ fine: true }) } as unknown as Response;
    const fetchMock = jest.fn().mockRejectedValueOnce(new TypeError("Network request failed")).mockResolvedValueOnce(ok);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(request("/facts")).resolves.toEqual({ fine: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("two dropped connections in a row report no connection", async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError("Network request failed")) as unknown as typeof fetch;
    await expect(request("/facts")).rejects.toMatchObject({ status: 0 });
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { accessError, isAllowedBrowserOrigin } from "../server/http.mjs";
import handler from "../api/search.js";
import shoppingIntentHandler from "../api/shopping-intent.js";
test("local backend permits tokenless use, but Vercel fails closed", () => {
  assert.equal(accessError({}, {}), null);
  assert.equal(accessError({}, { VERCEL: "1" }).status, 503);
  assert.equal(
    accessError({}, { VERCEL: "1", NEEDLE_ACCESS_TOKEN: "  " }).status,
    503,
  );
  assert.equal(
    accessError({}, { NEEDLE_ACCESS_TOKEN: "app-token" }).status,
    401,
  );
  assert.equal(
    accessError(
      { "x-needle-token": "app-token" },
      { VERCEL: "1", NEEDLE_ACCESS_TOKEN: "app-token" },
    ),
    null,
  );
});

test("local browser APIs allow Needle origins and reject unrelated websites", () => {
  assert.equal(
    isAllowedBrowserOrigin({
      origin: "http://127.0.0.1:4199",
      host: "127.0.0.1:4199",
    }),
    true,
  );
  assert.equal(
    isAllowedBrowserOrigin({
      origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
      host: "127.0.0.1:4199",
    }),
    true,
  );
  assert.equal(
    accessError(
      { origin: "https://attacker.example", host: "127.0.0.1:4199" },
      {},
    ).status,
    403,
  );
});
test("API rejects wrong methods before attempting inference", async () => {
  const res = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(n) {
      this.code = n;
      return this;
    },
    json(data) {
      this.body = data;
    },
  };
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.code, 405);
  assert.equal(res.headers.Allow, "POST");
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("shopping intent endpoint rejects wrong methods before calling a model", async () => {
  const res = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(n) {
      this.code = n;
      return this;
    },
    json(data) {
      this.body = data;
    },
  };
  await shoppingIntentHandler({ method: "GET", headers: {} }, res);
  assert.equal(res.code, 405);
  assert.equal(res.headers.Allow, "POST");
  assert.equal(res.headers["Cache-Control"], "no-store");
});

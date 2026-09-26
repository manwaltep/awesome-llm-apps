import test from "node:test";
import assert from "node:assert/strict";
import {
  isOfficialRetailerUrl,
  normalizeRetailerCards,
  retailerSearchUrl,
  retailerSearchTerm,
} from "../extension/catalogue.js";

test("builds search tabs for both official catalogue sites", () => {
  assert.equal(
    retailerSearchUrl("woolworths", "almond milk"),
    "https://www.woolworths.com.au/shop/search/products?searchTerm=almond%20milk",
  );
  assert.equal(
    retailerSearchUrl("coles", "almond milk"),
    "https://www.coles.com.au/search?q=almond%20milk",
  );
});

test("cleans conversational framing for the retailer search URL", () => {
  assert.equal(
    retailerSearchTerm("Could you find me oat milk under $4 at Woolies?"),
    "oat milk under $4",
  );
  assert.equal(
    retailerSearchTerm("specials on cheddar"),
    "specials on cheddar",
  );
});

test("accepts only official source URLs for the named retailer", () => {
  assert.equal(
    isOfficialRetailerUrl(
      "woolworths",
      "https://www.woolworths.com.au/shop/productdetails/123",
    ),
    true,
  );
  assert.equal(
    isOfficialRetailerUrl("coles", "https://coles.com.au/product/123"),
    true,
  );
  assert.equal(
    isOfficialRetailerUrl("coles", "https://example.com/coles/product/123"),
    false,
  );
});

test("normalizes real product cards and drops cross-site links", () => {
  const cards = normalizeRetailerCards(
    "coles",
    "https://www.coles.com.au/search?q=milk",
    [
      {
        title: "Coles Full Cream Milk 2L",
        detail: "$3.20 · $1.60 per litre",
        href: "/product/coles-full-cream-milk-2l-123456",
      },
      {
        title: "Sponsored milk offer",
        detail: "$1.00",
        href: "https://example.com/offer",
      },
    ],
  );

  assert.deepEqual(cards, [
    {
      id: "b0",
      store: "coles",
      title: "Coles Full Cream Milk 2L",
      detail: "$3.20 · $1.60 per litre",
      text: "Coles Full Cream Milk 2L\n$3.20 · $1.60 per litre",
      url: "https://www.coles.com.au/product/coles-full-cream-milk-2l-123456",
    },
  ]);
});

test("rejects retailer names and page URLs outside the supported allowlist", () => {
  assert.throws(
    () => retailerSearchUrl("aldi", "milk"),
    /Unsupported retailer/,
  );
  assert.deepEqual(
    normalizeRetailerCards("coles", "https://example.com/", [
      { title: "Milk", detail: "$1", href: "/milk" },
    ]),
    [],
  );
});

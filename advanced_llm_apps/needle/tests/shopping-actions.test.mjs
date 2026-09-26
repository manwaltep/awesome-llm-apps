import test from "node:test";
import assert from "node:assert/strict";
import {
  interpretShoppingTurn,
  validateShoppingActions,
} from "../server/shopping.mjs";

const list = [
  { id: "milk", name: "Milk", checked: false },
  { id: "bread", name: "Wholegrain bread", checked: false },
];

test("catalogue matches never check off a shopping-list item", () => {
  const actions = validateShoppingActions({
    transcript: "Woolworths has milk for $4.80",
    proposal: { searchQuery: "milk", addItems: [], completedItems: ["Milk"] },
    items: list,
  });

  assert.deepEqual(actions.completedItems, []);
});

test("getting catalogue information is not confirmation of getting the item", () => {
  const actions = validateShoppingActions({
    transcript: "I got milk prices from the catalogue",
    proposal: {
      searchQuery: "milk prices",
      addItems: [],
      completedItems: ["Milk"],
    },
    items: list,
  });

  assert.deepEqual(actions.completedItems, []);
});

test("explicitly putting a listed item in the trolley can check it off", () => {
  const actions = validateShoppingActions({
    transcript: "I put the milk in my trolley",
    proposal: { searchQuery: "", addItems: [], completedItems: ["Milk"] },
    items: list,
  });

  assert.deepEqual(actions.completedItems, ["milk"]);
});

test("explicitly finding a listed item on a shelf can check it off", () => {
  const actions = validateShoppingActions({
    transcript: "I found the wholegrain bread on the shelf",
    proposal: {
      searchQuery: "",
      addItems: [],
      completedItems: ["Wholegrain bread"],
    },
    items: list,
  });

  assert.deepEqual(actions.completedItems, ["bread"]);
});

test("adding an item is not treated as completing it", () => {
  const actions = validateShoppingActions({
    transcript: "Please add oat milk to my shopping list",
    proposal: {
      searchQuery: "",
      addItems: ["Oat milk"],
      completedItems: ["Oat milk"],
    },
    items: list,
  });

  assert.deepEqual(actions.addItems, ["Oat milk"]);
  assert.deepEqual(actions.completedItems, []);
});

test("a product mention alone cannot add it to the list", () => {
  const actions = validateShoppingActions({
    transcript: "Search for oat milk",
    proposal: { searchQuery: "oat milk", addItems: ["Oat milk"] },
    items: list,
  });

  assert.deepEqual(actions.addItems, []);
});

test("a named item wanted from Coles is added without other catalogue items", () => {
  const actions = validateShoppingActions({
    transcript: "I want oat milk from Coles",
    proposal: {
      catalogueQuery: "oat milk",
      addItems: ["Oat milk", "Bread"],
      completedItems: [],
    },
    items: list,
  });

  assert.deepEqual(actions.stores, ["coles"]);
  assert.deepEqual(actions.addItems, ["oat milk"]);
});

test("a named item wanted from Woolies adds only that item and keeps its retailer", () => {
  const actions = validateShoppingActions({
    transcript: "I need a 2L full cream milk from Woolworths",
    proposal: {
      catalogueQuery: "2L full cream milk",
      addItems: ["Milk", "Chocolate"],
      completedItems: [],
    },
    items: list,
  });

  assert.deepEqual(actions.stores, ["woolworths"]);
  assert.deepEqual(actions.addItems, ["2L full cream milk"]);
});

test("searching for an item from a retailer does not add it to the list", () => {
  const actions = validateShoppingActions({
    transcript: "Find oat milk from Coles",
    proposal: {
      catalogueQuery: "oat milk",
      addItems: ["Oat milk"],
      completedItems: [],
    },
    items: list,
  });

  assert.deepEqual(actions.stores, ["coles"]);
  assert.deepEqual(actions.addItems, []);
});

test("model suggestions cannot add unspoken or complete unlisted items", () => {
  const actions = validateShoppingActions({
    transcript: "I put the milk in my trolley",
    proposal: {
      searchQuery: "",
      addItems: ["Chocolate"],
      completedItems: ["Milk", "Chocolate"],
    },
    items: list,
  });

  assert.deepEqual(actions.addItems, []);
  assert.deepEqual(actions.completedItems, ["milk"]);
});

test("GPT-5.4-mini receives text only and returns guarded list actions", async () => {
  const result = await interpretShoppingTurn(
    {
      transcript: "Find oat milk under $4 and add oat milk to my list",
      items: list,
    },
    {
      key: "test-only",
      fetchImpl: async (url, options) => {
        assert.equal(url, "https://api.openai.com/v1/responses");
        assert.equal(options.headers.Authorization, "Bearer test-only");
        const request = JSON.parse(options.body);
        assert.equal(request.model, "gpt-5.4-mini");
        assert.equal(request.store, false);
        assert.equal(request.input[1].content.includes("Find oat milk"), true);
        return {
          ok: true,
          json: async () => ({
            output_text: JSON.stringify({
              catalogueQuery: "Find oat milk under $4",
              addItems: ["Oat milk"],
              completedItems: [],
            }),
          }),
        };
      },
    },
  );

  assert.deepEqual(result.addItems, ["Oat milk"]);
  assert.deepEqual(result.completedItems, []);
  assert.equal(JSON.stringify(result).includes("test-only"), false);
});

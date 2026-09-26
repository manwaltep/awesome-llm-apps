import test from "node:test";
import assert from "node:assert/strict";
import {
  isExplicitListCheck,
  parseVoiceShoppingActions,
} from "../extension/shopping.js";

const items = [
  { id: "milk", name: "Oat milk", checked: false },
  { id: "bread", name: "Wholegrain bread", checked: false },
];

test("direct spoken list requests keep the item, price and retailer together", () => {
  const actions = parseVoiceShoppingActions(
    "Please add Allen's Peaches and Cream from Woolies for $2.50 to my shopping list",
    items,
  );

  assert.deepEqual(actions.addItems, [
    {
      name: "Allen's Peaches and Cream",
      store: "Woolworths",
      price: "$2.50",
    },
  ]);
  assert.deepEqual(actions.completedItems, []);
});

test("a named retailer item the shopper wants can be added locally", () => {
  const actions = parseVoiceShoppingActions(
    "I want Allen's Peaches and Cream from Coles, $2.50",
    items,
  );
  assert.deepEqual(actions.addItems, [
    {
      name: "Allen's Peaches and Cream",
      store: "Coles",
      price: "$2.50",
    },
  ]);
});

test("a specific item the shopper is looking at is added without filling in missing details", () => {
  const actions = parseVoiceShoppingActions(
    "I'm looking at Allen's Peaches and Cream at Woolies for $2.5",
    items,
  );
  assert.deepEqual(actions.addItems, [
    {
      name: "Allen's Peaches and Cream",
      store: "Woolworths",
      price: "$2.50",
    },
  ]);
  assert.deepEqual(
    parseVoiceShoppingActions("Can you get this from Coles?", items).addItems,
    [],
  );
});

test("listed items are checked off only after explicit store or purchase language", () => {
  assert.deepEqual(
    parseVoiceShoppingActions(
      "I found the oat milk on the shelf at Coles",
      items,
    ).completedItems,
    ["milk"],
  );
  assert.deepEqual(
    parseVoiceShoppingActions("Woolworths has oat milk for $4.80", items)
      .completedItems,
    [],
  );
});

test("catalogue search language does not create a direct list addition", () => {
  const actions = parseVoiceShoppingActions(
    "Search for oat milk under $4",
    items,
  );
  assert.deepEqual(actions.addItems, []);
  assert.deepEqual(actions.completedItems, []);
});

test("Voice checks the list only when the shopper explicitly asks", () => {
  assert.equal(
    isExplicitListCheck("Can you do a confirmation check on my list?"),
    true,
  );
  assert.equal(isExplicitListCheck("What's on my shopping list?"), true);
  assert.equal(isExplicitListCheck("Can you check for oat milk?"), false);
  assert.equal(
    parseVoiceShoppingActions("Can you check my list?", items).listCheck,
    true,
  );
});

test("a bare yes is not a shopping-list addition or catalogue search", () => {
  const actions = parseVoiceShoppingActions("Yes.", items);
  assert.deepEqual(actions.addItems, []);
  assert.deepEqual(actions.completedItems, []);
  assert.equal(actions.listCheck, false);
});

test("a search need without a retailer remains a Jev catalogue request", () => {
  const actions = parseVoiceShoppingActions("I need steak", items);
  assert.deepEqual(actions.addItems, []);
  assert.deepEqual(actions.completedItems, []);
});

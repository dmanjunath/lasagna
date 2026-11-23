import AsyncStorage from "@react-native-async-storage/async-storage";
import { addView, deleteView, loadFilters, matchingView, renameView, resetViewsForTest, saveFilters, savedViews, withDefaults } from "../filter-store";
import { EMPTY_FILTERS } from "../txn-filters";

beforeEach(async () => {
  await AsyncStorage.clear();
  resetViewsForTest();
});

test("a page's filters come back as they were saved, per page", async () => {
  const f = { ...EMPTY_FILTERS, merchants: ["Costco"], sort: "oldest" as const };
  saveFilters("transactions", f);
  await new Promise((r) => setTimeout(r, 0));
  expect(await loadFilters("transactions")).toEqual(f);
  expect(await loadFilters("spending")).toBeNull();
});

test("filters saved by an older build gain the fields they lack", async () => {
  await AsyncStorage.setItem("lasagna-filters-spending", JSON.stringify({ categories: ["c1"] }));
  expect(await loadFilters("spending")).toEqual({ ...EMPTY_FILTERS, categories: ["c1"] });
  expect(withDefaults("junk")).toBeNull();
});

test("unreadable storage is no saved filters, not a crash", async () => {
  await AsyncStorage.setItem("lasagna-filters-transactions", "{not json");
  expect(await loadFilters("transactions")).toBeNull();
});

test("saved views: add, rename, delete, each page its own list, kept on the device", async () => {
  expect(await savedViews("transactions")).toEqual([]);
  const f = { ...EMPTY_FILTERS, accountIds: ["a1"] };
  addView("transactions", "  Card only ", f, "v1");
  expect(await savedViews("transactions")).toEqual([{ id: "v1", name: "Card only", filters: f }]);
  renameView("transactions", "v1", "Credit card");
  const list = await savedViews("transactions");
  expect(list[0].name).toBe("Credit card");
  await new Promise((r) => setTimeout(r, 0));
  expect(JSON.parse((await AsyncStorage.getItem("lasagna-views-transactions"))!)[0].name).toBe("Credit card");
  expect(matchingView(list, f)?.id).toBe("v1");
  expect(matchingView(list, EMPTY_FILTERS)).toBeNull();
  expect(await savedViews("spending")).toEqual([]);
  deleteView("transactions", "v1");
  expect(await savedViews("transactions")).toEqual([]);

  // Read back fresh from the device, older filters filled in.
  addView("spending", "Groceries", { ...EMPTY_FILTERS, categories: ["c1"] }, "v2");
  await new Promise((r) => setTimeout(r, 0));
  resetViewsForTest();
  expect((await savedViews("spending"))[0]).toMatchObject({ id: "v2", name: "Groceries", filters: { categories: ["c1"], sort: "newest" } });
});

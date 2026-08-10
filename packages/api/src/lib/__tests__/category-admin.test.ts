import { describe, it, expect } from "vitest";
import {
  isLockedCategory,
  isLockedGroup,
  categoryPatchError,
  categoryDeleteError,
  groupPatchError,
} from "../category-admin.js";

const sys = (systemKey: string) => ({ systemKey });
const custom = { systemKey: null };

describe("isLockedCategory / isLockedGroup", () => {
  it("locks exactly transfer/income/other categories", () => {
    expect(isLockedCategory(sys("transfer"))).toBe(true);
    expect(isLockedCategory(sys("income"))).toBe(true);
    expect(isLockedCategory(sys("other"))).toBe(true);
    expect(isLockedCategory(sys("groceries"))).toBe(false);
    expect(isLockedCategory(custom)).toBe(false);
  });
  it("locks exactly transfers/income/other groups", () => {
    expect(isLockedGroup(sys("transfers"))).toBe(true);
    expect(isLockedGroup(sys("income"))).toBe(true);
    expect(isLockedGroup(sys("other"))).toBe(true);
    expect(isLockedGroup(sys("shopping"))).toBe(false);
    expect(isLockedGroup(custom)).toBe(false);
  });
});

describe("categoryPatchError", () => {
  it("rejects disabling a locked category", () => {
    expect(categoryPatchError(sys("transfer"), { disabled: true })).toMatch(/can't be disabled/i);
    expect(categoryPatchError(sys("income"), { disabled: false })).toMatch(/can't be disabled/i);
  });
  it("allows renaming and disabling a non-locked system category", () => {
    expect(categoryPatchError(sys("groceries"), { name: "Food shopping" })).toBeNull();
    expect(categoryPatchError(sys("subscriptions"), { disabled: true })).toBeNull();
  });
  it("rejects moving or emoji-ing a system category", () => {
    expect(categoryPatchError(sys("groceries"), { groupId: "g2" })).toMatch(/system/i);
    expect(categoryPatchError(sys("groceries"), { emoji: "🛒" })).toMatch(/custom/i);
  });
  it("allows full edit on a custom category", () => {
    expect(categoryPatchError(custom, { name: "Consulting", emoji: "💼", groupId: "g2", disabled: true })).toBeNull();
  });
  it("validates name and emoji lengths", () => {
    expect(categoryPatchError(custom, { name: "" })).toMatch(/1-80/);
    expect(categoryPatchError(custom, { name: "x".repeat(81) })).toMatch(/1-80/);
    expect(categoryPatchError(custom, { emoji: "🛒🛒🛒🛒🛒" })).toMatch(/emoji/i);
    expect(categoryPatchError(sys("groceries"), { name: "x".repeat(81) })).toMatch(/1-80/);
  });
  it("requires disabled to be a boolean", () => {
    expect(categoryPatchError(custom, { disabled: "yes" })).toMatch(/boolean/i);
  });
  it("rejects a non-string name (e.g. null) with a type error", () => {
    expect(categoryPatchError(custom, { name: null })).toMatch(/name must be a string/i);
    expect(categoryPatchError(sys("groceries"), { name: null })).toMatch(/name must be a string/i);
  });
});

describe("categoryDeleteError", () => {
  it("blocks deleting any system category", () => {
    expect(categoryDeleteError(sys("groceries"))).toMatch(/can't be deleted/i);
    expect(categoryDeleteError(sys("other"))).toMatch(/can't be deleted/i);
  });
  it("allows deleting a custom category", () => {
    expect(categoryDeleteError(custom)).toBeNull();
  });
});

describe("groupPatchError", () => {
  it("rejects a type change on locked and system groups, allows rename", () => {
    expect(groupPatchError(sys("transfers"), { type: "expense" })).toMatch(/type/i);
    expect(groupPatchError(sys("shopping"), { type: "income" })).toMatch(/type/i);
    expect(groupPatchError(sys("transfers"), { name: "Movements" })).toBeNull();
    expect(groupPatchError(sys("shopping"), { name: "Retail" })).toBeNull();
  });
  it("allows name and type changes on custom groups", () => {
    expect(groupPatchError(custom, { name: "Side Business", type: "expense" })).toBeNull();
  });
  it("validates name length and type value", () => {
    expect(groupPatchError(custom, { name: "" })).toMatch(/1-80/);
    expect(groupPatchError(custom, { type: "weird" })).toMatch(/type/i);
  });
  it("rejects a non-string name (e.g. null) with a type error", () => {
    expect(groupPatchError(custom, { name: null })).toMatch(/name must be a string/i);
    expect(groupPatchError(sys("shopping"), { name: null })).toMatch(/name must be a string/i);
  });
});

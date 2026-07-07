// Pure guards for the category/group management CRUD. System rows carry a
// systemKey; the locked three (Transfer/Income/Other) can never be disabled
// and their groups can't change type or be deleted.

import { LOCKED_CATEGORY_KEYS, LOCKED_GROUP_KEYS } from "@lasagna/core";

interface SystemKeyed {
  systemKey: string | null;
}

export interface CategoryPatch {
  name?: unknown;
  emoji?: unknown;
  groupId?: unknown;
  disabled?: unknown;
}

export interface GroupPatch {
  name?: unknown;
  type?: unknown;
}

const GROUP_TYPES = ["income", "expense", "transfer"];

export function isLockedCategory(cat: SystemKeyed): boolean {
  return cat.systemKey !== null && (LOCKED_CATEGORY_KEYS as readonly string[]).includes(cat.systemKey);
}

export function isLockedGroup(group: SystemKeyed): boolean {
  return group.systemKey !== null && (LOCKED_GROUP_KEYS as readonly string[]).includes(group.systemKey);
}

// Returns an error message, or null when the patch is allowed.
export function categoryPatchError(cat: SystemKeyed, patch: CategoryPatch): string | null {
  if (cat.systemKey !== null) {
    if (patch.groupId !== undefined) return "System categories can't be moved to another group";
    if (patch.emoji !== undefined) return "Only custom categories can have an emoji";
  }
  if (patch.disabled !== undefined) {
    if (isLockedCategory(cat)) return "This category can't be disabled";
    if (typeof patch.disabled !== "boolean") return "disabled must be a boolean";
  }
  if (patch.name !== undefined) {
    if (typeof patch.name !== "string") return "name must be a string";
    const name = patch.name.trim();
    if (name.length < 1 || name.length > 80) return "Name must be 1-80 characters";
  }
  if (patch.emoji !== undefined) {
    if (String(patch.emoji).length > 8) return "Emoji must be at most 8 characters";
  }
  return null;
}

export function categoryDeleteError(cat: SystemKeyed): string | null {
  return cat.systemKey !== null ? "System categories can't be deleted" : null;
}

export function groupPatchError(group: SystemKeyed, patch: GroupPatch): string | null {
  if (patch.type !== undefined) {
    if (group.systemKey !== null) return "This group's type can't be changed";
    if (!GROUP_TYPES.includes(String(patch.type))) return "type must be income, expense, or transfer";
  }
  if (patch.name !== undefined) {
    if (typeof patch.name !== "string") return "name must be a string";
    const name = patch.name.trim();
    if (name.length < 1 || name.length > 80) return "Name must be 1-80 characters";
  }
  return null;
}

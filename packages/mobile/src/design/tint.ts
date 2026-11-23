import type { ColorRoles, TintRole } from "@lasagna/design";

/**
 * Whether the theme gives a role a color of its own. A theme with no role
 * colors maps every role to its plain card, so a component that would lean
 * on the role's color to mean something (a chosen pill, a debt's chart line)
 * keeps its own default there instead.
 */
export function hasRoleColor(c: ColorRoles, role: TintRole): boolean {
  return c.tint[role].fill !== c.surface;
}

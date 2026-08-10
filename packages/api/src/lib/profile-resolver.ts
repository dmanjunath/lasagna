import {
  eq,
  and,
  users,
  financialProfiles,
  userProfiles,
} from "@lasagna/core";
import { db } from "./db.js";

// ── Field classification (single source of truth) ────────────────────────────
// HOUSEHOLD fields stay on the tenant-scoped `financialProfiles` row.
// PERSONAL fields resolve per-user from `userProfiles` ("your income vs your
// partner's income"). The priorities bookkeeping columns
// (skippedPrioritySteps/completedPrioritySteps/lastActionsGeneratedAt) also stay
// household but are handled directly by their callers, not through this split.
export const HOUSEHOLD_FIELDS = [
  "filingStatus",
  "stateOfResidence",
  "dependentCount",
] as const;

export const PERSONAL_FIELDS = [
  "dateOfBirth",
  "annualIncome",
  "employmentType",
  "riskTolerance",
  "retirementAge",
  "employerMatch",
  "hasHDHP",
  "isPSLFEligible",
] as const;

// The subset of the household `financialProfiles` row the resolver reads.
export interface HouseholdProfileRow {
  filingStatus: string | null;
  stateOfResidence: string | null;
  dependentCount: number | null;
}

// The per-user `userProfiles` row (db-column shape).
export interface PersonalProfileRow {
  dateOfBirth: Date | null;
  annualIncome: string | null;
  employmentType: string | null;
  riskTolerance: string | null;
  retirementAge: number | null;
  employerMatch: string | null;
  hasHDHP: boolean | null;
  isPSLFEligible: boolean | null;
}

// The merged shape returned to callers — exactly what GET /financial-profile
// has always returned (household + personal + derived age).
export interface ResolvedProfile {
  dateOfBirth: Date | null;
  age: number | null;
  annualIncome: number | null;
  filingStatus: string | null;
  stateOfResidence: string | null;
  employmentType: string | null;
  riskTolerance: string | null;
  retirementAge: number | null;
  employerMatchPercent: number | null;
  dependentCount: number | null;
  hasHDHP: boolean | null;
  isPSLFEligible: boolean | null;
}

function ageFromDob(dob: Date | null | undefined): number | null {
  if (!dob) return null;
  return Math.floor(
    (Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000),
  );
}

/**
 * Merge a household `financialProfiles` row with a per-user `userProfiles` row
 * into the flat response shape. Missing rows → nulls. Pure; no DB access.
 */
export function resolveProfile(
  household: HouseholdProfileRow | null | undefined,
  personal: PersonalProfileRow | null | undefined,
): ResolvedProfile {
  const dateOfBirth = personal?.dateOfBirth ?? null;
  return {
    dateOfBirth,
    age: ageFromDob(dateOfBirth),
    annualIncome:
      personal?.annualIncome != null ? parseFloat(personal.annualIncome) : null,
    filingStatus: household?.filingStatus ?? null,
    stateOfResidence: household?.stateOfResidence ?? null,
    employmentType: personal?.employmentType ?? null,
    riskTolerance: personal?.riskTolerance ?? null,
    retirementAge: personal?.retirementAge ?? null,
    employerMatchPercent:
      personal?.employerMatch != null ? parseFloat(personal.employerMatch) : null,
    dependentCount: household?.dependentCount ?? null,
    hasHDHP: personal?.hasHDHP ?? null,
    isPSLFEligible: personal?.isPSLFEligible ?? null,
  };
}

// The PATCH /financial-profile request shape (response-shaped field names).
export interface ProfileInput {
  dateOfBirth?: string | null;
  annualIncome?: number | null;
  filingStatus?: string | null;
  stateOfResidence?: string | null;
  employmentType?: string | null;
  riskTolerance?: string | null;
  retirementAge?: number | null;
  employerMatchPercent?: number | null;
  dependentCount?: number | null;
  hasHDHP?: boolean | null;
  isPSLFEligible?: boolean | null;
}

/**
 * Split an incoming PATCH body into household-table values and personal-table
 * values (both in db-column form). Only keys present in the body are included
 * (undefined skipped; null kept so an explicit clear reaches the DB). Pure.
 */
export function splitProfileInput(body: ProfileInput): {
  householdValues: Record<string, unknown>;
  personalValues: Record<string, unknown>;
} {
  const householdValues: Record<string, unknown> = {};
  const personalValues: Record<string, unknown> = {};

  if (body.filingStatus !== undefined) householdValues.filingStatus = body.filingStatus;
  if (body.stateOfResidence !== undefined)
    householdValues.stateOfResidence = body.stateOfResidence;
  if (body.dependentCount !== undefined)
    householdValues.dependentCount = body.dependentCount ?? null;

  if (body.dateOfBirth !== undefined)
    personalValues.dateOfBirth = body.dateOfBirth ? new Date(body.dateOfBirth) : null;
  if (body.annualIncome !== undefined)
    personalValues.annualIncome = body.annualIncome?.toString() ?? null;
  if (body.employmentType !== undefined)
    personalValues.employmentType = body.employmentType;
  if (body.riskTolerance !== undefined)
    personalValues.riskTolerance = body.riskTolerance;
  if (body.retirementAge !== undefined)
    personalValues.retirementAge = body.retirementAge;
  if (body.employerMatchPercent !== undefined)
    personalValues.employerMatch = body.employerMatchPercent?.toString() ?? null;
  if (body.hasHDHP !== undefined) personalValues.hasHDHP = body.hasHDHP ?? null;
  if (body.isPSLFEligible !== undefined)
    personalValues.isPSLFEligible = body.isPSLFEligible ?? null;

  return { householdValues, personalValues };
}

// ── db-backed helpers (thin wrappers; callers stay thin) ─────────────────────

/** The household `financialProfiles` row (full row — includes bookkeeping). */
export function readHouseholdProfile(tenantId: string) {
  return db.query.financialProfiles.findFirst({
    where: eq(financialProfiles.tenantId, tenantId),
  });
}

/** A specific user's personal `userProfiles` row. */
export function readUserPersonalProfile(tenantId: string, userId: string) {
  return db.query.userProfiles.findFirst({
    where: and(eq(userProfiles.tenantId, tenantId), eq(userProfiles.userId, userId)),
  });
}

/**
 * The tenant owner's personal profile — used by session-less/tenant-level reads
 * (the insights cron), which have no requesting user to key off.
 */
export async function readOwnerPersonalProfile(tenantId: string) {
  const owner = await db.query.users.findFirst({
    where: and(eq(users.tenantId, tenantId), eq(users.role, "owner")),
    columns: { id: true },
  });
  if (!owner) return undefined;
  return readUserPersonalProfile(tenantId, owner.id);
}

/**
 * Resolve the merged profile for the requesting user (session/agent reads).
 */
export async function readResolvedProfile(
  tenantId: string,
  userId: string,
): Promise<ResolvedProfile> {
  const [household, personal] = await Promise.all([
    readHouseholdProfile(tenantId),
    readUserPersonalProfile(tenantId, userId),
  ]);
  return resolveProfile(household ?? null, personal ?? null);
}

/**
 * Apply a PATCH body: household fields → the tenant `financialProfiles` row,
 * personal fields → the session user's `userProfiles` row (upsert on userId).
 */
export async function upsertSplitProfile(
  tenantId: string,
  userId: string,
  body: ProfileInput,
): Promise<void> {
  const { householdValues, personalValues } = splitProfileInput(body);

  if (Object.keys(householdValues).length > 0) {
    const existing = await db.query.financialProfiles.findFirst({
      where: eq(financialProfiles.tenantId, tenantId),
    });
    if (existing) {
      await db
        .update(financialProfiles)
        .set(householdValues)
        .where(eq(financialProfiles.tenantId, tenantId));
    } else {
      await db.insert(financialProfiles).values({ tenantId, ...householdValues });
    }
  }

  if (Object.keys(personalValues).length > 0) {
    await db
      .insert(userProfiles)
      .values({ tenantId, userId, ...personalValues })
      .onConflictDoUpdate({ target: userProfiles.userId, set: personalValues });
  }
}

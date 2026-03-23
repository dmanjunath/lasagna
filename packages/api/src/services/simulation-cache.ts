import { db } from "../lib/db.js";
import { simulationResults } from "@lasagna/core";
import { eq, and, sql } from "@lasagna/core";
import { createHash } from "crypto";

type SimulationType = "monte_carlo" | "backtest" | "scenario";

export interface CacheEntry<T> {
  id: string;
  planId: string;
  type: SimulationType;
  params: Record<string, unknown>;
  results: T;
  createdAt: Date;
  expiresAt: Date;
}

export class SimulationCacheService {
  private hashParams(params: Record<string, unknown>): string {
    const json = JSON.stringify(params, Object.keys(params).sort());
    return createHash("md5").update(json).digest("hex");
  }

  async get<T>(planId: string, type: SimulationType, params: Record<string, unknown>): Promise<T | null> {
    const paramsHash = this.hashParams(params);
    const [cached] = await db
      .select()
      .from(simulationResults)
      .where(and(
        eq(simulationResults.planId, planId),
        eq(simulationResults.type, type),
        eq(simulationResults.paramsHash, paramsHash),
        sql`${simulationResults.expiresAt} > NOW()`
      ))
      .limit(1);
    if (!cached) return null;
    return JSON.parse(cached.results) as T;
  }

  async set<T>(planId: string, tenantId: string, type: SimulationType, params: Record<string, unknown>, results: T, ttlHours: number = 24): Promise<string> {
    const paramsHash = this.hashParams(params);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + ttlHours);

    await db.delete(simulationResults).where(and(
      eq(simulationResults.planId, planId),
      eq(simulationResults.type, type),
      eq(simulationResults.paramsHash, paramsHash)
    ));

    const [inserted] = await db.insert(simulationResults).values({
      planId, tenantId, type, paramsHash,
      params: JSON.stringify(params),
      results: JSON.stringify(results),
      expiresAt,
    }).returning({ id: simulationResults.id });

    return inserted.id;
  }

  async invalidateForPlan(planId: string): Promise<number> {
    const result = await db.delete(simulationResults).where(eq(simulationResults.planId, planId));
    return result.rowCount ?? 0;
  }

  async cleanupExpired(): Promise<number> {
    const result = await db.delete(simulationResults).where(sql`${simulationResults.expiresAt} < NOW()`);
    return result.rowCount ?? 0;
  }
}

let _cache: SimulationCacheService | null = null;
export function getSimulationCache(): SimulationCacheService {
  if (!_cache) { _cache = new SimulationCacheService(); }
  return _cache;
}

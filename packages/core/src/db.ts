import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDb(databaseUrl: string) {
  const socketPath = process.env.DB_SOCKET_PATH;
  const client = socketPath
    ? postgres({ host: socketPath, user: "lasagna", pass: process.env.DB_PASSWORD, database: "lasagna" })
    : postgres(databaseUrl);
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;

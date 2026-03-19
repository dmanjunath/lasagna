import { createDb } from "@lasagna/core";
import { env } from "./env.js";

export const db = createDb(env.DATABASE_URL);

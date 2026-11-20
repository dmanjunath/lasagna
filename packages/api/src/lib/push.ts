import { GoogleAuth } from "google-auth-library";
import { and, eq, inArray, sql, pushTokens } from "@lasagna/core";
import { db } from "./db.js";

/**
 * Push notifications through FCM HTTP v1. FCM delivers to iOS via the APNs key
 * uploaded to the Firebase project, so the server never talks to Apple.
 *
 * Needs no configuration. Credentials and the project come from ADC: on Cloud
 * Run the service account holds roles/firebasecloudmessaging.admin. Locally,
 * `gcloud auth application-default login` with the same project works.
 */
const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
});

let cachedProject: string | undefined;

async function project(): Promise<string> {
  if (cachedProject) return cachedProject;
  try {
    cachedProject = await auth.getProjectId();
  } catch {
    const client = await auth.getClient();
    if (!client.quotaProjectId) {
      throw new Error(
        "Could not determine the GCP project. Run `gcloud auth application-default login`."
      );
    }
    cachedProject = client.quotaProjectId;
  }
  return cachedProject;
}

/** A token moves to whoever signs in on that device last. */
export async function savePushToken(userId: string, token: string, platform: string): Promise<void> {
  await db
    .insert(pushTokens)
    .values({ token, userId, platform })
    .onConflictDoUpdate({
      target: pushTokens.token,
      set: { userId, platform, updatedAt: sql`now()` },
    });
}

export async function deletePushToken(userId: string, token: string): Promise<void> {
  await db
    .delete(pushTokens)
    .where(and(eq(pushTokens.token, token), eq(pushTokens.userId, userId)));
}

/**
 * FCM's answer for a token that will never work again: the app was deleted,
 * the token rotated, or it was never valid. Those rows are deleted. Anything
 * else (quota, outage, auth) leaves the token alone.
 */
export function isDeadToken(status: number, body: unknown): boolean {
  const details = (body as { error?: { details?: { errorCode?: string }[] } })?.error?.details ?? [];
  const codes = details.map((d) => d.errorCode);
  if (codes.includes("UNREGISTERED")) return true;
  return status === 400 && codes.includes("INVALID_ARGUMENT");
}

export interface PushMessage {
  title: string;
  body: string;
  /** Opened when the notification is tapped. An in-app path, e.g. "/spending". */
  path?: string;
}

/** Sends to every device the user is signed in on. Returns how many accepted it. */
export async function sendPushToUser(userId: string, message: PushMessage): Promise<{ sent: number; failed: number }> {
  const rows = await db.select({ token: pushTokens.token }).from(pushTokens).where(eq(pushTokens.userId, userId));
  if (rows.length === 0) return { sent: 0, failed: 0 };

  const url = `https://fcm.googleapis.com/v1/projects/${await project()}/messages:send`;
  const headers = { Authorization: `Bearer ${await auth.getAccessToken()}`, "Content-Type": "application/json" };

  const dead: string[] = [];
  let sent = 0;
  await Promise.all(
    rows.map(async ({ token }) => {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: {
            token,
            notification: { title: message.title, body: message.body },
            data: message.path ? { path: message.path } : undefined,
          },
        }),
      });
      if (res.ok) {
        sent++;
        return;
      }
      const body = await res.json().catch(() => null);
      if (isDeadToken(res.status, body)) dead.push(token);
      else console.error(`[push] FCM send failed (${res.status})`, JSON.stringify(body));
    })
  );
  if (dead.length > 0) await db.delete(pushTokens).where(inArray(pushTokens.token, dead));
  return { sent, failed: rows.length - sent };
}

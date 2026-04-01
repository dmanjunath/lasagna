import { Storage } from "@google-cloud/storage";
import { env } from "./env.js";

const storage = new Storage();

function getBucket() {
  return storage.bucket(env.GCS_BUCKET);
}

export async function uploadFile(
  tenantId: string,
  documentId: string,
  fileName: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const gcsPath = `${tenantId}/${documentId}/${fileName}`;
  const file = getBucket().file(gcsPath);
  await file.save(buffer, { contentType });
  return gcsPath;
}

export async function deleteFile(gcsPath: string): Promise<void> {
  try {
    await getBucket().file(gcsPath).delete();
  } catch {
    // Best-effort deletion — orphaned files are acceptable
  }
}

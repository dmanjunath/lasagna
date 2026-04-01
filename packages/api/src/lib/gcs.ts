import { Storage } from "@google-cloud/storage";
import { env } from "./env.js";

let _storage: Storage | null = null;

function getStorage() {
  if (!_storage) _storage = new Storage();
  return _storage;
}

function getBucket() {
  return getStorage().bucket(env.GCS_BUCKET);
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

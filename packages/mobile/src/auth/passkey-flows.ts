import * as Passkeys from "react-native-passkeys";
import { webauthnApi, type Session } from "@/api/auth";
import { setPasskeyRegistered, toCreateRequest, toGetRequest, toServerResponse } from "./passkey";

/** The user dismissed the system passkey sheet: not an error to show. */
export function isPasskeyCancel(e: unknown): boolean {
  const err = e as { code?: string; name?: string; message?: string } | null;
  return /cancel/i.test(`${err?.code ?? ""} ${err?.name ?? ""} ${err?.message ?? ""}`);
}

/** Sign in with a passkey on this device (the web's loginWithPasskey). */
export async function signInWithPasskey(): Promise<Session> {
  const options = await webauthnApi.loginOptions();
  const result = await Passkeys.get(toGetRequest(options));
  if (!result) throw new Error("Couldn't sign in with Face ID.");
  const session = await webauthnApi.loginVerify(toServerResponse(result as never));
  setPasskeyRegistered(true);
  return session;
}

/** Registers a passkey for the signed-in user (FaceIdSetupPrompt's second half). */
export async function registerPasskey(): Promise<void> {
  const options = await webauthnApi.registerOptions();
  const result = await Passkeys.create(toCreateRequest(options));
  if (!result) throw new Error("Passkey registration returned nothing.");
  await webauthnApi.registerVerify(toServerResponse(result as never));
  setPasskeyRegistered(true);
}

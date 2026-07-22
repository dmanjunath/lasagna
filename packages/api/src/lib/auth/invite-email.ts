import { env } from "../env.js";

// v1: log the accept URL and best-effort send via the transactional email path.
// Acceptance still requires the recipient to authenticate; the token is the
// security primitive, so a missing email transport never weakens the flow.
export async function sendInviteEmail(input: {
  email: string;
  inviterName: string | null;
  token: string;
}): Promise<void> {
  const acceptUrl = `${env.APP_URL}/accept-invite?token=${input.token}`;
  console.log(`[Invite] ${input.inviterName ?? "Someone"} invited ${input.email}: ${acceptUrl}`);
  // TODO(email transport): wire to the real transactional sender if/when a
  // generic (non-Magic-Auth) send helper exists. No-throw by design.
}

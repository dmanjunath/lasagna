import { env } from "../env.js";

// Sends the household invite as a transactional email via the Cloudflare Email
// Service REST API. Best-effort by design: when email isn't configured or the
// send fails, it logs the accept URL instead of throwing, so a transport
// problem never blocks invite creation. The token in the URL is the security
// primitive and acceptance still requires the recipient to authenticate.
export async function sendInviteEmail(input: {
  email: string;
  inviterName: string | null;
  token: string;
}): Promise<void> {
  const acceptUrl = `${env.APP_URL}/accept-invite?token=${input.token}`;
  const inviter = input.inviterName?.trim() || "Someone";

  const accountId = env.CLOUDFLARE_EMAIL_ACCOUNT_ID;
  const apiToken = env.CLOUDFLARE_EMAIL_TOKEN;
  const from = env.CLOUDFLARE_EMAIL_FROM;
  if (!accountId || !apiToken || !from) {
    console.log(`[Invite] (email transport not configured) ${inviter} invited ${input.email}: ${acceptUrl}`);
    return;
  }

  const subject = `${inviter} invited you to their household on Lasagna`;
  const text =
    `${inviter} invited you to share their household on Lasagna, where you'll see the same accounts and plans with your own private login.\n\n` +
    `Join here:\n${acceptUrl}\n\n` +
    `If you weren't expecting this, you can safely ignore this email.`;

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ to: input.email, from, subject, html: inviteHtml(inviter, acceptUrl), text }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[Invite] Cloudflare email send failed (${res.status}) for ${input.email}: ${body}\n  Accept URL: ${acceptUrl}`);
      return;
    }
    console.log(`[Invite] emailed invite to ${input.email} (from ${inviter})`);
  } catch (err) {
    console.error(`[Invite] Cloudflare email send error for ${input.email}:`, err, `\n  Accept URL: ${acceptUrl}`);
  }
}

function inviteHtml(inviter: string, acceptUrl: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f7fa;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:32px 0;">
      <tr><td align="center">
        <table role="presentation" width="440" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#101828;">
          <tr><td>
            <div style="font-size:20px;font-weight:700;margin-bottom:8px;">You've been invited to Lasagna</div>
            <div style="font-size:15px;line-height:1.5;color:#475467;margin-bottom:24px;">
              <strong>${esc(inviter)}</strong> invited you to share their household. You'll see the same accounts and plans, with your own private login and chat.
            </div>
            <a href="${esc(acceptUrl)}" style="display:inline-block;background:#05b279;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px;">Join the household</a>
            <div style="font-size:13px;line-height:1.5;color:#98a2b3;margin-top:24px;">
              If the button doesn't work, paste this link into your browser:<br />
              <a href="${esc(acceptUrl)}" style="color:#05b279;word-break:break-all;">${esc(acceptUrl)}</a>
            </div>
            <div style="font-size:13px;line-height:1.5;color:#98a2b3;margin-top:16px;">
              If you weren't expecting this, you can safely ignore this email.
            </div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

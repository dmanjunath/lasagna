import { env } from "../env.js";

// Hosted on the marketing site (packages/landing/public/lasagnafi-mark.png).
// Email clients strip inline SVG / data-URIs, so the mark is a hosted PNG; the
// text wordmark next to it still renders when images are blocked.
const MARK_URL = "https://lasagnafi.com/lasagnafi-mark.png";

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

  const subject = `${inviter} invited you to their household on LasagnaFi`;

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: input.email,
          from,
          subject,
          html: inviteHtml(inviter, acceptUrl, input.email),
          text: inviteText(inviter, acceptUrl, input.email),
        }),
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

const escHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function inviteText(inviter: string, acceptUrl: string, recipient: string): string {
  return [
    `${inviter} invited you to their household on LasagnaFi.`,
    ``,
    `LasagnaFi is a calmer way to see your money — accounts, balances, and plans in one place. ${inviter} wants to share theirs with you, so you both see the same picture while keeping your own private login and chat.`,
    ``,
    `Join here:`,
    acceptUrl,
    ``,
    `What you get`,
    `• One shared view of your finances — accounts, balances, and plans, pooled together`,
    `• Your own login and private chat — your conversations stay yours`,
    `• Plan and edit together, without ever sharing a password`,
    ``,
    `This invite was sent to ${recipient}. No account is created until you accept, and nothing changes on your side if you ignore it.`,
  ].join("\n");
}

export function inviteHtml(inviter: string, acceptUrl: string, recipient: string): string {
  const feature = (title: string, body: string) => `
              <tr>
                <td width="26" valign="top" style="padding:7px 0;">
                  <div style="width:18px;height:18px;border-radius:50%;background:#e7f7f0;text-align:center;line-height:18px;font-size:11px;font-weight:700;color:#05b279;">&#10003;</div>
                </td>
                <td valign="top" style="padding:6px 0 6px 10px;font-size:14px;line-height:1.5;color:#344054;">
                  <strong style="color:#1d2939;font-weight:600;">${escHtml(title)}</strong> ${escHtml(body)}
                </td>
              </tr>`;
  const url = escHtml(acceptUrl);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light" />
    <title>You're invited to LasagnaFi</title>
  </head>
  <body style="margin:0;padding:0;background:#eef1f6;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">See the same accounts and plans together, each with your own private login &amp; chat.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:100%;background:#ffffff;border-radius:18px;border:1px solid #e6e9ef;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <tr><td style="height:4px;background:#05b279;line-height:4px;font-size:0;">&nbsp;</td></tr>
            <tr>
              <td style="padding:24px 34px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="vertical-align:middle;padding-right:9px;">
                      <img src="${MARK_URL}" width="36" height="31" alt="LasagnaFi" style="display:block;border:0;outline:none;text-decoration:none;" />
                    </td>
                    <td style="vertical-align:middle;">
                      <span style="font-size:19px;font-weight:800;letter-spacing:-0.02em;color:#1d2939;">Lasagna<span style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-weight:600;letter-spacing:0;">fi</span></span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 34px 0;">
                <div style="font-size:22px;line-height:1.28;font-weight:800;letter-spacing:-0.015em;color:#101828;margin:0 0 12px;">${escHtml(inviter)} invited you to their household</div>
                <div style="font-size:15px;line-height:1.6;color:#475467;margin:0 0 24px;"><strong style="color:#1d2939;font-weight:600;">LasagnaFi</strong> is a calmer way to see your money, all in one place. <strong style="color:#1d2939;font-weight:600;">${escHtml(inviter)}</strong> wants to share theirs with you, so you both see the same accounts, balances, and plans, while each keeping your own private login and chat.</div>
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:12px;background:#05b279;">
                      <a href="${url}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;border-radius:12px;">Join the household &rarr;</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 34px 4px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${feature("One shared view", "of your accounts, balances, and plans, pooled together.")}
                  ${feature("Your own login and private chat", "your conversations stay yours.")}
                  ${feature("Plan together", "edit the same finances without ever sharing a password.")}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 34px 24px;">
                <div style="font-size:12.5px;line-height:1.55;color:#98a2b3;">Button not working? Paste this link into your browser:<br /><a href="${url}" style="color:#05b279;text-decoration:underline;word-break:break-all;">${url}</a></div>
              </td>
            </tr>
            <tr><td style="padding:0 34px;"><div style="height:1px;background:#eef1f6;line-height:1px;font-size:0;">&nbsp;</div></td></tr>
            <tr>
              <td style="padding:16px 34px 28px;">
                <div style="font-size:12px;line-height:1.6;color:#98a2b3;">This invite was sent to ${escHtml(recipient)}. No account is created until you accept, and nothing changes on your side if you ignore it.</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

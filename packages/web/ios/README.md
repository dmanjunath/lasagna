# iOS App Store Submission Checklist

App: **LasagnaFi** · Bundle ID: **com.lasagnafi.app**

## 1. Prerequisites

- Enroll in the Apple Developer Program ($99/yr) at https://developer.apple.com/programs/.
- Publish a privacy policy at a public URL (e.g. `https://lasagnafi.com/privacy`). App Store Connect requires it; there isn't one yet.
- Confirm the production API is up and reachable at `https://app.lasagnafi.com`.
- Verify WorkOS **Magic Auth is enabled in the production WorkOS environment** — it gates both login codes and account-deletion re-auth codes. (It was found disabled in the dev sandbox; check prod explicitly.)

## 2. One-time setup after enrollment

1. Copy `lasagna-infra/ios/signing.env.example` to `lasagna-infra/ios/signing.env` and set `IOS_TEAM_ID` to your Team ID (developer.apple.com → Membership details) and `VITE_API_URL=https://app.lasagnafi.com`. Keep the Team ID out of this public repo.
2. Replace `TEAMID` in `packages/web/public/.well-known/apple-app-site-association` with the real Team ID (`TEAMID.com.lasagnafi.app` → `<TEAM_ID>.com.lasagnafi.app`) and redeploy the web app. Universal links (`applinks:app.lasagnafi.com` in the entitlements) depend on this file. Committing the Team ID *here* is fine and required — AASA files are publicly fetchable by design (unlike `signing.env`, which stays in lasagna-infra); don't "fix" it back to the placeholder.
3. Verify the AASA file is served correctly:

   ```sh
   curl -i https://app.lasagnafi.com/.well-known/apple-app-site-association
   ```

   Expect HTTP 200, `Content-Type: application/json`, and no redirect.
4. Open `packages/web/ios/App/App.xcodeproj` in Xcode once, sign in with the Apple ID, and accept the team / let automatic provisioning register the bundle ID if prompted.

## 3. Build the artifact

```sh
pnpm -F @lasagna/web ios:archive
```

This runs `packages/web/scripts/ios-archive.sh`: builds the web bundle against `VITE_API_URL`, syncs Capacitor, archives, and exports a signed IPA to `packages/web/ios/build/export/App.ipa`.

Bump `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in the Xcode project (`packages/web/ios/App/App.xcodeproj`) before each new upload — App Store Connect rejects duplicate build numbers.

Upload the build either way:
- **Xcode Organizer**: open the `.xcarchive` in `packages/web/ios/build/` (Window → Organizer → Distribute App), or
- **Transporter**: drag `App.ipa` into the Transporter app and deliver.

## 4. App Store Connect setup

1. Create the app in App Store Connect with bundle ID `com.lasagnafi.app`, name **LasagnaFi**.
2. **Availability: United States only.** Subscriptions use Stripe web checkout via an external purchase link, permitted under the May 2025 US ruling (Epic v. Apple) — US storefront only. Do not add other countries in v1.
3. **App Privacy labels** (Data Collection):
   - Financial Info (transactions, balances — via Plaid) — linked to identity, not used for tracking.
   - Contact Info (email) and Identifiers (user ID) — linked to identity, not used for tracking.
   - No third-party advertising or tracking. The privacy manifest is at `packages/web/ios/App/App/PrivacyInfo.xcprivacy`.
4. Set the privacy policy URL (from Prerequisites).
5. **Account deletion question: answer YES** — the app supports in-app deletion (Settings → Delete account).
6. **Demo account for App Review**: provide working credentials. Seed one with `pnpm db:seed-demo` (root package.json) or create a dedicated review account on prod. Because login uses emailed codes, the demo account must work for reviewers — verify the flow end to end before submitting.
7. **Screenshots**: required for 6.9" (iPhone 16 Pro Max) and 6.5" (e.g. iPhone 11 Pro Max) displays. Run the app in each simulator and capture:

   ```sh
   xcrun simctl io booted screenshot screenshot.png
   ```

8. Export compliance is pre-answered: `ITSAppUsesNonExemptEncryption=NO` is already in Info.plist, as is the Face ID usage string.

## 5. Review notes template

Paste into App Review notes (adjust credentials):

> LasagnaFi is a personal finance app. Bank data is aggregated via Plaid (read-only; users authenticate directly with their bank through Plaid Link).
>
> Subscriptions are purchased on our website via Stripe. The app links out to this external purchase flow under the updated US App Store guidelines (post-May 2025, external purchase links permitted for the US storefront). The app is distributed in the United States only.
>
> Demo account: [email] — login is passwordless; enter the emailed 6-digit code. If the reviewer cannot receive email, contact us and we will supply a code.
>
> Account deletion is available in-app under Settings → Delete account.

## 6. TestFlight, then submit

1. Upload a build (Section 3) and wait for processing.
2. Distribute to internal testers via TestFlight; exercise login, Plaid linking, the Stripe link-out and `/billing/success` universal-link return, and account deletion on a real device.
3. Fix anything found, bump the build number, re-upload.
4. Attach the tested build to the App Store version, complete Section 4, and Submit for Review.

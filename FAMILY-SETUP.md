# Family workspace setup (one time, about 10 minutes)

The Family workspace lets both of you sign in with your own Google accounts and see the same numbers. It uses a small Cloudflare Worker with KV storage. This is a new Worker. Your existing Anthropic proxy Worker doesn't change.

## 1. Create the storage

Cloudflare dashboard → Storage & Databases → KV → Create a namespace. Name it `accounting-family`.

## 2. Create the Worker

Workers & Pages → Create → Create Worker. Name it `accounting-family`. Click Deploy, then Edit code. Delete everything in the editor, paste the whole contents of `accounting-family-worker.js`, and click Deploy.

## 3. Connect the storage to the Worker

Open the `accounting-family` Worker → Settings → Bindings → Add → KV namespace.

- Variable name: `FAMILY_KV` (exactly this)
- KV namespace: `accounting-family`

Save. Copy the Worker's URL from the top of its page. It looks like `https://accounting-family.<your-subdomain>.workers.dev`.

## 4. In the app

1. Settings → paste the URL into **Family Worker URL** → Save.
2. Sign in with Google.
3. Tap the workspace button at the top (it says **Mine**) → **Family**.
4. Create a family, then add your partner's Google email.

## 5. On your partner's phone

Open the app, sign in with their own Google account, paste the same Family Worker URL in Settings, tap the workspace button → **Family**, and pick the family. Done.

## Notes

- Only the email addresses added to the family can read or write it. The Worker checks each request with Google.
- If you both save at the same moment, the app merges both sets of changes. The newest edit to any one item wins.
- The Worker refuses to replace a family copy that has data with an empty one, so a fresh device can't wipe it.
- Imported transactions are stored in Cloudflare KV under your Cloudflare account. The free plan covers this easily.

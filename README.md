# Worker-proxy

A minimal Cloudflare Worker that accepts GET query params and rewrites them into a JSON-RPC request for Ankr:

- Destination base URL: `https://rpc.ankr.com/multichain/[apikey]`
- API key source: Worker secret `ANKR_API_KEY` (populated from GitHub repo secret in CI)

## How it works

1. You call the Worker with a GET request and query params.
2. The Worker builds a JSON-RPC payload (default `ankr_getAccountBalance`).
3. The Worker forwards to `https://rpc.ankr.com/multichain/${ANKR_API_KEY}`.
4. The Worker returns the upstream response (with permissive CORS headers).

## Query params

- `walletAddress` (required unless `params` is provided)
- `blockchain` (repeatable or comma-separated, default `eth`)
- `nativeFirst` (default `true`)
- `onlyWhitelisted` (default `true`)
- `pageSize` (default `10`)
- `pageToken` (optional)
- `method` (default `ankr_getAccountBalance`)
- `id` (default `1`)
- `forwardMethod` (`POST` default, or `GET`)
- `params` (optional raw JSON object string; if present, overrides field-based params)

## Example request to Worker

```bash
curl --request GET \
  --url 'https://<your-worker>.workers.dev/?method=ankr_getAccountBalance&blockchain=eth&nativeFirst=true&onlyWhitelisted=true&pageSize=10&pageToken=1&walletAddress=0xE936e8FAf4A5655469182A49a505055B71C17604'
```

That becomes this upstream JSON-RPC POST body by default:

```json
{
  "jsonrpc": "2.0",
  "method": "ankr_getAccountBalance",
  "params": {
    "blockchain": ["eth"],
    "nativeFirst": true,
    "onlyWhitelisted": true,
    "pageSize": 10,
    "pageToken": "1",
    "walletAddress": "0xE936e8FAf4A5655469182A49a505055B71C17604"
  },
  "id": 1
}
```

## Local development

```bash
npm install
npx wrangler login
npx wrangler secret put ANKR_API_KEY
npm run dev
```

`wrangler login` opens a browser flow so Wrangler can deploy and manage secrets on your account. For CI, use an API token instead (below).

## Cloudflare API token and account ID

### Create `CLOUDFLARE_API_TOKEN`

1. Cloudflare dashboard → **My Profile** → **API Tokens** → **Create Token**.
2. Use a template like **Edit Cloudflare Workers**, or create a **Custom token** with at least:
   - **Account** → **Workers Scripts** → **Edit**

That is enough to deploy this Worker to `*.workers.dev`.

You may not see **Account → Workers Routes** in the token builder. That is common. **Routes are only needed if you attach the Worker to a custom hostname or zone route.** For the default `workers.dev` URL, you do not need a routes permission.

If you do use custom domains or zone routes, add **Zone**-scoped permission (scoped to that zone), for example:

- **Zone** → **Workers Routes** → **Edit**

Keep the token scoped to the correct **Account** (and **Zone**, if you add zone permissions).

### Get `CLOUDFLARE_ACCOUNT_ID`

In the Cloudflare dashboard, open the target account and copy **Account ID** from the overview sidebar.

## GitHub Actions secrets

Add these under the repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret | Description |
|--------|-------------|
| `ANKR_API_KEY` | Ankr API key (path segment after `/multichain/`) |
| `CLOUDFLARE_API_TOKEN` | API token with **Workers Scripts: Edit** (see above) |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |

The workflow (`.github/workflows/deploy.yml`) sets `ANKR_API_KEY` on the Worker via `wrangler secret put`, then runs `wrangler deploy`.

### If deploy fails with auth errors

- Token is scoped to the wrong **account**.
- Token is missing **Workers Scripts: Edit**.
- `CLOUDFLARE_ACCOUNT_ID` does not match the account the token can access.

# Worker-proxy

A minimal Cloudflare Worker that accepts GET query params or POST JSON body params and rewrites them into a JSON-RPC request for Ankr:

- Destination base URL: `https://rpc.ankr.com/multichain/[apikey]`
- API key source: Worker secret `ANKR_API_KEY` (populated from GitHub repo secret in CI)

## How it works

1. You call the Worker with either:
   - a GET request with query params, or
   - a POST request with a JSON body.
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

## POST JSON body fields

- `walletAddress` (required unless `params` is provided)
- `blockchain` (array or comma-separated string; default `["eth"]`)
- `nativeFirst` (default `true`)
- `onlyWhitelisted` (default `true`)
- `pageSize` (default `10`)
- `pageToken` (optional)
- `method` (default `ankr_getAccountBalance`)
- `id` (default `1`)
- `forwardMethod` (`POST` default, or `GET`)
- `params` (optional JSON object; if present, overrides field-based params)

## Example request to Worker

### Deployed (`*.workers.dev`)

```bash
curl --request GET \
  --url 'https://<your-worker>.workers.dev/?method=ankr_getAccountBalance&blockchain=eth&nativeFirst=true&onlyWhitelisted=true&pageSize=10&pageToken=1&walletAddress=0xE936e8FAf4A5655469182A49a505055B71C17604'
```

### Local (`wrangler dev`)

After `npm run dev`, Wrangler usually serves at `http://127.0.0.1:8787` (check the terminal output if yours differs):

```bash
curl --request GET \
  --url 'http://127.0.0.1:8787/?method=ankr_getAccountBalance&blockchain=eth&nativeFirst=true&onlyWhitelisted=true&pageSize=10&pageToken=1&walletAddress=0xE936e8FAf4A5655469182A49a505055B71C17604'
```

Use a `.dev.vars` file with `ANKR_API_KEY=...` so the Worker can call Ankr locally.

### POST request to Worker (JSON body params)

```bash
curl --request POST \
  --url 'http://127.0.0.1:8787/' \
  --header 'accept: application/json' \
  --header 'content-type: application/json' \
  --data '{
  "method": "ankr_getAccountBalance",
  "id": 1,
  "forwardMethod": "POST",
  "blockchain": ["eth"],
  "nativeFirst": true,
  "onlyWhitelisted": true,
  "pageSize": 10,
  "pageToken": "1",
  "walletAddress": "0xE936e8FAf4A5655469182A49a505055B71C17604"
}'
```

### Direct call to Ankr (same JSON-RPC the Worker sends)

Without the proxy, the equivalent request is a POST to `https://rpc.ankr.com/multichain/<your-api-key>`:

```bash
curl --request POST \
  --url 'https://rpc.ankr.com/multichain/<your-api-key>' \
  --header 'accept: application/json' \
  --header 'content-type: application/json' \
  --data '{
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
}'
```

The GET examples above build this same JSON-RPC payload (default `forwardMethod=POST`).

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

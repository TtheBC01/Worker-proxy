interface Env {
  ANKR_API_KEY: string;
  ANKR_API_BASE?: string;
}

interface JsonRpcPayload {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
  id: string | number;
}

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,OPTIONS",
  "access-control-allow-headers": "content-type"
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "GET") {
      return withCors(
        Response.json({ error: "Only GET requests are supported." }, { status: 405 })
      );
    }

    if (!env.ANKR_API_KEY) {
      return withCors(
        Response.json(
          { error: "ANKR_API_KEY is missing. Add it as a Worker secret." },
          { status: 500 }
        )
      );
    }

    const inputUrl = new URL(request.url);
    const method = inputUrl.searchParams.get("method") ?? "ankr_getAccountBalance";
    const id = inputUrl.searchParams.get("id") ?? 1;
    const forwardMethod = (inputUrl.searchParams.get("forwardMethod") ?? "POST").toUpperCase();

    const params = readParams(inputUrl.searchParams);
    if (!params.walletAddress) {
      return withCors(
        Response.json(
          { error: "Missing walletAddress query parameter." },
          { status: 400 }
        )
      );
    }

    const payload: JsonRpcPayload = {
      jsonrpc: "2.0",
      method,
      params,
      id
    };

    const apiBase = (env.ANKR_API_BASE ?? "https://rpc.ankr.com/multichain").replace(/\/+$/, "");
    const destination = `${apiBase}/${env.ANKR_API_KEY}`;

    const upstreamResponse = await forwardToDestination(destination, forwardMethod, payload);
    const responseBody = await upstreamResponse.text();

    const responseHeaders = new Headers(upstreamResponse.headers);
    for (const [name, value] of Object.entries(CORS_HEADERS)) {
      responseHeaders.set(name, value);
    }

    return new Response(responseBody, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders
    });
  }
};

async function forwardToDestination(
  destination: string,
  forwardMethod: string,
  payload: JsonRpcPayload
): Promise<Response> {
  if (forwardMethod === "GET") {
    const url = new URL(destination);
    url.searchParams.set("jsonrpc", "2.0");
    url.searchParams.set("method", payload.method);
    url.searchParams.set("id", String(payload.id));
    url.searchParams.set("params", JSON.stringify(payload.params));

    return fetch(url.toString(), {
      method: "GET",
      headers: {
        accept: "application/json"
      }
    });
  }

  return fetch(destination, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

function readParams(searchParams: URLSearchParams): Record<string, unknown> {
  const explicitParams = searchParams.get("params");
  if (explicitParams) {
    try {
      const parsed = JSON.parse(explicitParams);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Fall back to field-based parsing when params isn't valid JSON.
    }
  }

  const walletAddress = searchParams.get("walletAddress") ?? undefined;
  const blockchainRaw = searchParams.getAll("blockchain");
  const blockchain = blockchainRaw
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  const nativeFirst = readBoolean(searchParams.get("nativeFirst"), true);
  const onlyWhitelisted = readBoolean(searchParams.get("onlyWhitelisted"), true);
  const pageSize = readNumber(searchParams.get("pageSize"), 10);
  const pageToken = searchParams.get("pageToken") ?? undefined;

  return {
    blockchain: blockchain.length ? blockchain : ["eth"],
    nativeFirst,
    onlyWhitelisted,
    pageSize,
    pageToken,
    walletAddress
  };
}

function readBoolean(value: string | null, fallback: boolean): boolean {
  if (value == null) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readNumber(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

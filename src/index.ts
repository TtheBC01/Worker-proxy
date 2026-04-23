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
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "GET" && request.method !== "POST") {
      return withCors(
        Response.json({ error: "Only GET and POST requests are supported." }, { status: 405 })
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

    const input = await readInput(request);
    if (input.error) {
      return withCors(Response.json({ error: input.error }, { status: 400 }));
    }

    const method = input.method ?? "ankr_getAccountBalance";
    const id = input.id ?? 1;
    const forwardMethod = (input.forwardMethod ?? "POST").toUpperCase();
    const params = input.params;
    if (!params.walletAddress) {
      return withCors(
        Response.json(
          { error: "Missing walletAddress in query params or JSON body." },
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

interface ParsedInput {
  method?: string;
  id?: string | number;
  forwardMethod?: string;
  params: Record<string, unknown>;
  error?: string;
}

async function readInput(request: Request): Promise<ParsedInput> {
  const url = new URL(request.url);
  if (request.method === "GET") {
    return {
      method: url.searchParams.get("method") ?? undefined,
      id: url.searchParams.get("id") ?? undefined,
      forwardMethod: url.searchParams.get("forwardMethod") ?? undefined,
      params: readParams(url.searchParams)
    };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      params: {},
      error: "POST body must be valid JSON."
    };
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      params: {},
      error: "POST body must be a JSON object."
    };
  }

  const input = body as Record<string, unknown>;
  const paramsFromBody = readBodyParams(input);
  return {
    method: readOptionalString(input.method),
    id: readOptionalId(input.id),
    forwardMethod: readOptionalString(input.forwardMethod),
    params: paramsFromBody
  };
}

function readBodyParams(input: Record<string, unknown>): Record<string, unknown> {
  const explicitParams = input.params;
  if (explicitParams && typeof explicitParams === "object" && !Array.isArray(explicitParams)) {
    return explicitParams as Record<string, unknown>;
  }

  const blockchain = normalizeBlockchain(input.blockchain);
  return {
    blockchain: blockchain.length ? blockchain : ["eth"],
    nativeFirst: readBooleanFromUnknown(input.nativeFirst, true),
    onlyWhitelisted: readBooleanFromUnknown(input.onlyWhitelisted, true),
    pageSize: readNumberFromUnknown(input.pageSize, 10),
    pageToken: readOptionalString(input.pageToken),
    walletAddress: readOptionalString(input.walletAddress)
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

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readOptionalId(value: unknown): string | number | undefined {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  return undefined;
}

function readBooleanFromUnknown(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  }
  return fallback;
}

function readNumberFromUnknown(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function normalizeBlockchain(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

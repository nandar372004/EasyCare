const SAFE_ERROR = {
  error: {
    code: "GUARDIAN_UNAVAILABLE",
    message: "Guardian is temporarily unavailable.",
  },
};

function jsonResponse(body: unknown, status: number, origin?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] =
      "authorization, x-client-info, apikey, content-type";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers.Vary = "Origin";
  }
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers,
  });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

Deno.serve(async (request) => {
  const requestOrigin = request.headers.get("origin") ?? "";
  const allowedOrigins = (
    Deno.env.get("AI_ALLOWED_ORIGINS") ??
    "http://localhost:5173,http://127.0.0.1:5173"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigin = allowedOrigins.includes(requestOrigin)
    ? requestOrigin
    : undefined;

  if (requestOrigin && !allowedOrigin)
    return jsonResponse(
      {
        error: {
          code: "ORIGIN_DENIED",
          message: "Request origin is not allowed.",
        },
      },
      403,
    );
  if (request.method === "OPTIONS") return jsonResponse({}, 204, allowedOrigin);
  if (request.method !== "POST")
    return jsonResponse(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
      405,
      allowedOrigin,
    );

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer "))
    return jsonResponse(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "A valid session is required.",
        },
      },
      401,
      allowedOrigin,
    );

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const providerKey = Deno.env.get("AI_PROVIDER_API_KEY");
  const modelName = Deno.env.get("AI_MODEL_NAME");
  const policyVersion = Deno.env.get("AI_GUARDIAN_POLICY_VERSION");
  const rateLimitPepper = Deno.env.get("AI_RATE_LIMIT_PEPPER");
  const providerEndpoint = Deno.env.get("AI_PROVIDER_URL");
  if (
    !supabaseUrl ||
    !anonKey ||
    !serviceRoleKey ||
    !providerKey ||
    !modelName ||
    !policyVersion ||
    !rateLimitPepper ||
    !providerEndpoint
  ) {
    return jsonResponse(SAFE_ERROR, 503, allowedOrigin);
  }

  let createClient: typeof import("npm:@supabase/supabase-js@2.109.0").createClient;
  let executeGuardianGateway: typeof import("../_shared/guardian-gateway.ts").executeGuardianGateway;
  let createOpenAICompatibleAdapter: typeof import("../_shared/guardian-provider.ts").createOpenAICompatibleAdapter;
  try {
    ({ createClient } = await import("npm:@supabase/supabase-js@2.109.0"));
    ({ executeGuardianGateway } =
      await import("../_shared/guardian-gateway.ts"));
    ({ createOpenAICompatibleAdapter } =
      await import("../_shared/guardian-provider.ts"));
  } catch {
    console.error("ai-health-guardian:dependency-load-failed");
    return jsonResponse(SAFE_ERROR, 503, allowedOrigin);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(
      {
        error: {
          code: "INVALID_JSON",
          message: "The request could not be safely processed.",
        },
      },
      400,
      allowedOrigin,
    );
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const clientAddress =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("cf-connecting-ip")?.trim() ??
    "unknown";

  const result = await executeGuardianGateway(
    payload,
    { authorization, clientAddress },
    {
      authenticate: async (bearer) => {
        const token = bearer.slice("Bearer ".length);
        const { data: authData, error: authError } =
          await userClient.auth.getUser(token);
        if (authError || !authData.user) return null;
        const { data: profile, error: profileError } = await userClient
          .from("profiles")
          .select("role, is_active")
          .eq("id", authData.user.id)
          .maybeSingle();
        if (profileError || !profile) return null;
        return {
          userId: authData.user.id,
          role: profile.role,
          isActive: profile.is_active,
        };
      },
      consumeRateLimits: async (userId, address) => {
        const userHash = await sha256(
          `${rateLimitPepper}:ai-guardian:user:${userId}`,
        );
        const ipHash = await sha256(
          `${rateLimitPepper}:ai-guardian:ip:${address}`,
        );
        const [userLimit, ipLimit] = await Promise.all([
          admin.rpc("consume_auth_rate_limit", {
            p_key_hash: userHash,
            p_action: "ai_guardian_user",
            p_attempt_limit: 20,
            p_window_seconds: 900,
          }),
          admin.rpc("consume_auth_rate_limit", {
            p_key_hash: ipHash,
            p_action: "ai_guardian_ip",
            p_attempt_limit: 60,
            p_window_seconds: 900,
          }),
        ]);
        if (userLimit.error || ipLimit.error)
          throw new Error("RATE_LIMIT_UNAVAILABLE");
        return userLimit.data === true && ipLimit.data === true;
      },
      model: createOpenAICompatibleAdapter({
        apiKey: providerKey,
        modelName,
        endpoint: providerEndpoint,
      }),
      policyVersion,
      modelName,
      timeoutMs: 25000,
      // Only fixed operational event codes are accepted here. Raw input, full
      // prompts, medical context, and provider payloads are never logged.
      operationalLog: (eventCode) => console.error(eventCode),
    },
  );

  return jsonResponse(result.body, result.status, allowedOrigin);
});

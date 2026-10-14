import { createWhoNewsLoader } from "../_shared/who-health-news.ts";

const loadWhoNews = createWhoNewsLoader();
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  }
  if (!request.headers.get("authorization")?.startsWith("Bearer ")) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  try {
    const result = await loadWhoNews();
    return Response.json(result, {
      headers: { ...corsHeaders, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return Response.json({ error: "Health updates are temporarily unavailable." }, {
      status: 503,
      headers: { ...corsHeaders, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
});

import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

type OperatorContext = { supabase: any; supabaseAdmin: any };
type InviteRequest = { action: "invite_personal"; email?: unknown; display_name?: unknown; idempotency_key?: unknown };
type ListRequest = { action: "list_personal_clients" };
type AccessRequest = { action: "set_personal_access"; admission_ref?: unknown; status?: unknown };
type OperatorRequest = InviteRequest | ListRequest | AccessRequest;

const entryOrigin = Deno.env.get("ENTRY_APP_ORIGIN") ?? "https://entry.leademergence.com";
const maximumAuthPages = 20;

const operatorClients = {
  fetch: withSupabase({ auth: ["publishable"] }, async (request: Request, context: OperatorContext) => {
    if (request.method !== "POST") return response({ error: "METHOD_NOT_ALLOWED" }, 405);
    const operator = await requireAal2Operator(request, context);
    if (!operator) return response({ error: "OPERATOR_AUTH_REQUIRED" }, 403);
    const payload = await request.json().catch(() => null) as OperatorRequest | null;
    if (!payload || typeof payload.action !== "string") return response({ error: "REQUEST_INVALID" }, 400);
    if (payload.action === "invite_personal") return invitePersonal(payload, operator.id, context);
    if (payload.action === "list_personal_clients") return listPersonalClients(context);
    if (payload.action === "set_personal_access") return setPersonalAccess(payload, context);
    return response({ error: "REQUEST_INVALID" }, 400);
  }),
};

export default operatorClients;

async function invitePersonal(payload: InviteRequest, operatorId: string, context: OperatorContext) {
  const email = normalizeEmail(payload.email);
  const displayName = normalizeDisplayName(payload.display_name);
  const idempotencyKey = normalizeUuid(payload.idempotency_key);
  if (!email || !idempotencyKey) return response({ error: "REQUEST_INVALID" }, 400);
  const started = await context.supabaseAdmin.rpc("begin_entry_personal_admission", {
    p_operator_user_id: operatorId, p_idempotency_key: idempotencyKey, p_email_fingerprint: await fingerprint(email),
  });
  const start = Array.isArray(started.data) ? started.data[0] : started.data;
  if (started.error || !start?.request_id) return response({ error: "ADMISSION_UNAVAILABLE" }, 429);
  if (start.already_started) return response({ lifecycle: sanitizeLifecycle(start) });
  const matched = await findAuthUsersByExactEmail(context.supabaseAdmin, email);
  if (matched.kind === "ambiguous" || matched.kind === "unavailable") {
    const failure = matched.kind === "ambiguous" ? "AMBIGUOUS_SUBJECT" : "AUTH_LOOKUP_UNAVAILABLE";
    await completeAdmission(context.supabaseAdmin, start.request_id, null, "pending", "pending", failure);
    return response({ error: failure }, matched.kind === "ambiguous" ? 409 : 503);
  }
  let canonicalUserId: string;
  let identityState: "invite_sent" | "existing_identity";
  if (matched.user) { canonicalUserId = matched.user.id; identityState = "existing_identity"; }
  else {
    const invited = await context.supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: new URL("/auth/callback?next=%2Fworkspaces", entryOrigin).toString(),
      data: displayName ? { display_name: displayName } : undefined,
    });
    if (invited.error || !invited.data.user?.id) {
      await completeAdmission(context.supabaseAdmin, start.request_id, null, "pending", "pending", "INVITE_UNAVAILABLE");
      return response({ error: "INVITE_UNAVAILABLE" }, 503);
    }
    canonicalUserId = invited.data.user.id; identityState = "invite_sent";
  }
  const entitlement = await context.supabaseAdmin.rpc("set_entry_product_entitlement", {
    p_canonical_user_id: canonicalUserId, p_product: "PERSONAL", p_status: "ACTIVE",
    p_source: "owner_personal_invite_v1", p_display_name: displayName,
  });
  if (entitlement.error) {
    await completeAdmission(context.supabaseAdmin, start.request_id, canonicalUserId, identityState, "pending", "ENTITLEMENT_UNAVAILABLE");
    return response({ error: "ENTITLEMENT_UNAVAILABLE" }, 503);
  }
  if (!await completeAdmission(context.supabaseAdmin, start.request_id, canonicalUserId, identityState, "active", null)) return response({ error: "ADMISSION_UNAVAILABLE" }, 503);
  return response({ lifecycle: { identity: identityState, personal: "active" } }, 201);
}

async function listPersonalClients(context: OperatorContext) {
  const listed = await context.supabaseAdmin.rpc("list_entry_personal_admissions");
  if (listed.error || !Array.isArray(listed.data)) return response({ error: "ADMISSION_UNAVAILABLE" }, 503);
  const clients = await Promise.all(listed.data.map(async (admission: any) => {
    const summary = admission.canonical_user_id ? await context.supabaseAdmin.rpc("get_workspace_personal_admission_summary", { p_user_id: admission.canonical_user_id }) : null;
    const graph = Array.isArray(summary?.data) ? summary.data[0] : summary?.data;
    return {
      admission_ref: typeof admission.request_fingerprint === "string" ? admission.request_fingerprint : null,
      identity: safeState(admission.identity_state, "pending"),
      personal: safeState(admission.personal_state, "pending"),
      lifecycle: safeState(admission.lifecycle_state, "processing"),
      graph: safeState(graph?.graph_state, admission.canonical_user_id ? "unavailable" : "absent"),
      mcp_connections: typeof graph?.mcp_connection_count === "number" ? graph.mcp_connection_count : 0,
    };
  }));
  return response({ clients: clients.filter((client) => client.admission_ref) });
}

async function setPersonalAccess(payload: AccessRequest, context: OperatorContext) {
  const requestRef = normalizeFingerprint(payload.admission_ref);
  const status = payload.status === "active" || payload.status === "suspended" ? payload.status : null;
  if (!requestRef || !status) return response({ error: "REQUEST_INVALID" }, 400);
  const subject = await context.supabaseAdmin.rpc("get_entry_personal_admission_subject", { p_request_fingerprint: requestRef });
  const canonicalUserId = typeof subject.data === "string" ? subject.data : null;
  if (subject.error || !canonicalUserId) return response({ error: "ADMISSION_UNAVAILABLE" }, 409);
  if (status === "suspended" && !await setEntitlement(context.supabaseAdmin, canonicalUserId, "SUSPENDED", "owner_personal_suspension_v1")) return response({ error: "ADMISSION_UNAVAILABLE" }, 503);
  const workspace = await context.supabaseAdmin.rpc("set_workspace_personal_admission_status", {
    p_user_id: canonicalUserId, p_status: status, p_reason_code: status === "suspended" ? "ENTRY_OPERATOR_SUSPENSION" : "ENTRY_OPERATOR_REACTIVATION",
  });
  if (workspace.error) return response({ error: status === "suspended" ? "SUSPENSION_PARTIAL" : "ADMISSION_UNAVAILABLE" }, 503);
  if (status === "active" && !await setEntitlement(context.supabaseAdmin, canonicalUserId, "ACTIVE", "owner_personal_reactivation_v1")) return response({ error: "ADMISSION_UNAVAILABLE" }, 503);
  const recorded = await context.supabaseAdmin.rpc("set_entry_personal_admission_state", { p_request_fingerprint: requestRef, p_personal_state: status });
  if (recorded.error || typeof recorded.data !== "string") return response({ error: "ADMISSION_UNAVAILABLE" }, 503);
  return response({ personal: status });
}

async function setEntitlement(admin: any, canonicalUserId: string, status: "ACTIVE" | "SUSPENDED", source: string) {
  const result = await admin.rpc("set_entry_product_entitlement", { p_canonical_user_id: canonicalUserId, p_product: "PERSONAL", p_status: status, p_source: source, p_display_name: null });
  return !result.error;
}

async function requireAal2Operator(request: Request, context: OperatorContext) {
  const authorization = request.headers.get("authorization"); const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return null;
  const userResult = await context.supabase.auth.getUser(token); const user = userResult.data?.user;
  if (userResult.error || !user) return null;
  const aal = await context.supabase.auth.mfa.getAuthenticatorAssuranceLevel(token);
  if (aal.error || aal.data?.currentLevel !== "aal2") return null;
  const operator = await context.supabaseAdmin.rpc("is_entry_operator_service", { p_canonical_user_id: user.id });
  return operator.error || operator.data !== true ? null : { id: user.id };
}

async function findAuthUsersByExactEmail(admin: any, email: string) {
  const matches: Array<{ id: string }> = [];
  for (let page = 1; page <= maximumAuthPages; page += 1) {
    const listed = await admin.auth.admin.listUsers({ page, perPage: 1000 }); if (listed.error) return { kind: "unavailable" as const };
    for (const user of listed.data.users ?? []) if (typeof user.email === "string" && user.email.trim().toLowerCase() === email) { matches.push({ id: user.id }); if (matches.length > 1) return { kind: "ambiguous" as const }; }
    if ((listed.data.users?.length ?? 0) < 1000) return { kind: "ok" as const, user: matches[0] ?? null };
  }
  return { kind: "unavailable" as const };
}

async function completeAdmission(admin: any, requestId: string, canonicalUserId: string | null, identityState: "pending" | "invite_sent" | "existing_identity" | "identity_confirmed", personalState: "pending" | "active" | "suspended", failureClass: string | null) {
  const result = await admin.rpc("complete_entry_personal_admission", { p_request_id: requestId, p_canonical_user_id: canonicalUserId, p_identity_state: identityState, p_personal_state: personalState, p_failure_class: failureClass }); return !result.error && result.data === true;
}

function normalizeEmail(value: unknown) { if (typeof value !== "string") return null; const normalized = value.trim().toLowerCase(); return normalized.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null; }
function normalizeDisplayName(value: unknown) { if (value === undefined || value === null || value === "") return null; if (typeof value !== "string") return null; const normalized = value.trim().replace(/\s+/g, " "); return normalized.length > 0 && normalized.length <= 200 ? normalized : null; }
function normalizeUuid(value: unknown) { if (typeof value !== "string") return null; const normalized = value.trim(); return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized) ? normalized : null; }
function normalizeFingerprint(value: unknown) { return typeof value === "string" && /^[a-f0-9]{16}$/.test(value) ? value : null; }
async function fingerprint(value: string) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`lead-emergence:entry-operator:v1:${value}`)); return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16); }
function safeState(value: unknown, fallback: string) { return typeof value === "string" && /^[a-z_]+$/i.test(value) ? value : fallback; }
function sanitizeLifecycle(value: { lifecycle_state?: unknown; identity_state?: unknown; personal_state?: unknown }) { return { state: safeState(value.lifecycle_state, "processing"), identity: safeState(value.identity_state, "pending"), personal: safeState(value.personal_state, "pending") }; }
function response(body: Record<string, unknown>, status = 200) { return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }); }

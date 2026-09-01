-- DOMAIN OWNER: Lead Emergence Entry
-- PURPOSE: Owner-approved, AAL2-gated Personal admission. This records only
-- opaque lifecycle state; the Edge Function owns email handling and Supabase
-- Auth admin calls, and entitlement changes remain in the existing command.

create table if not exists entry_identity.entry_operators (
  canonical_user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended')),
  bootstrap_source text not null check (char_length(bootstrap_source) between 3 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists entry_identity.personal_admission_requests (
  id uuid primary key default gen_random_uuid(),
  operator_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  email_fingerprint text not null check (email_fingerprint ~ '^[a-f0-9]{16}$'),
  canonical_user_id uuid references auth.users(id) on delete set null,
  lifecycle_state text not null default 'processing' check (lifecycle_state in ('processing', 'completed', 'failed')),
  identity_state text not null default 'pending' check (identity_state in ('pending', 'invite_sent', 'existing_identity', 'identity_confirmed')),
  personal_state text not null default 'pending' check (personal_state in ('pending', 'active', 'suspended')),
  failure_class text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (operator_user_id, idempotency_key)
);

create index if not exists personal_admission_requests_operator_updated_idx
  on entry_identity.personal_admission_requests (operator_user_id, updated_at desc);

create table if not exists entry_identity.operator_action_audit (
  id uuid primary key default gen_random_uuid(),
  operator_fingerprint text not null check (operator_fingerprint ~ '^[a-f0-9]{16}$'),
  subject_fingerprint text,
  request_fingerprint text,
  action_type text not null check (action_type in (
    'operator_bootstrapped', 'personal_admission_started', 'personal_admission_completed',
    'personal_admission_failed', 'personal_suspended', 'personal_reactivated'
  )),
  outcome text not null,
  created_at timestamptz not null default now()
);

alter table entry_identity.entry_operators enable row level security;
alter table entry_identity.personal_admission_requests enable row level security;
alter table entry_identity.operator_action_audit enable row level security;
revoke all on table entry_identity.entry_operators, entry_identity.personal_admission_requests, entry_identity.operator_action_audit from public, anon, authenticated;
grant select, insert, update on entry_identity.entry_operators, entry_identity.personal_admission_requests to service_role;
grant insert on entry_identity.operator_action_audit to service_role;

create or replace function entry_identity.operator_fingerprint(p_value text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select left(encode(extensions.digest('lead-emergence:entry-operator:v1:' || p_value, 'sha256'), 'hex'), 16);
$$;

create or replace function public.get_my_entry_operator_status()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from entry_identity.entry_operators
    where canonical_user_id = auth.uid() and status = 'active'
  );
$$;

create or replace function public.is_entry_operator_service(p_canonical_user_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select current_user in ('service_role', 'postgres') and exists (
    select 1 from entry_identity.entry_operators
    where canonical_user_id = p_canonical_user_id and status = 'active'
  );
$$;

create or replace function public.bootstrap_entry_operator(p_canonical_user_id uuid, p_source text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare v_source text := trim(coalesce(p_source, ''));
begin
  if current_user not in ('service_role', 'postgres') then raise exception 'Trusted Entry operator bootstrap is required.' using errcode = '42501'; end if;
  if char_length(v_source) not between 3 and 120 then raise exception 'A concise bootstrap source is required.' using errcode = '22023'; end if;
  if exists (select 1 from entry_identity.entry_operators) then raise exception 'Entry operator bootstrap is already complete.' using errcode = '23505'; end if;
  if not exists (select 1 from auth.users where id = p_canonical_user_id) then raise exception 'The selected canonical user does not exist.' using errcode = '23503'; end if;
  insert into entry_identity.entry_operators (canonical_user_id, bootstrap_source) values (p_canonical_user_id, v_source);
  insert into entry_identity.operator_action_audit (operator_fingerprint, action_type, outcome)
  values (entry_identity.operator_fingerprint(p_canonical_user_id::text), 'operator_bootstrapped', 'ACTIVE');
  return true;
end;
$$;

create or replace function public.begin_entry_personal_admission(p_operator_user_id uuid, p_idempotency_key uuid, p_email_fingerprint text)
returns table(request_id uuid, lifecycle_state text, canonical_user_id uuid, already_started boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare existing_request entry_identity.personal_admission_requests%rowtype; new_request_id uuid;
begin
  if current_user not in ('service_role', 'postgres') then raise exception 'Trusted Entry operator service is required.' using errcode = '42501'; end if;
  if p_operator_user_id is null or p_idempotency_key is null or p_email_fingerprint !~ '^[a-f0-9]{16}$' then raise exception 'Invalid operator admission request.' using errcode = '22023'; end if;
  if not exists (select 1 from entry_identity.entry_operators where canonical_user_id = p_operator_user_id and status = 'active') then raise exception 'The requested Entry operator is not active.' using errcode = '42501'; end if;
  select * into existing_request from entry_identity.personal_admission_requests where operator_user_id = p_operator_user_id and idempotency_key = p_idempotency_key limit 1;
  if found then return query select existing_request.id, existing_request.lifecycle_state, existing_request.canonical_user_id, true; return; end if;
  if (select count(*) from entry_identity.personal_admission_requests where operator_user_id = p_operator_user_id and created_at > now() - interval '1 hour') >= 20 then raise exception 'Operator admission rate limit reached.' using errcode = '42901'; end if;
  insert into entry_identity.personal_admission_requests (operator_user_id, idempotency_key, email_fingerprint) values (p_operator_user_id, p_idempotency_key, p_email_fingerprint) returning id into new_request_id;
  insert into entry_identity.operator_action_audit (operator_fingerprint, request_fingerprint, action_type, outcome)
  values (entry_identity.operator_fingerprint(p_operator_user_id::text), entry_identity.operator_fingerprint(new_request_id::text), 'personal_admission_started', 'PROCESSING');
  return query select new_request_id, 'processing'::text, null::uuid, false;
end;
$$;

create or replace function public.complete_entry_personal_admission(p_request_id uuid, p_canonical_user_id uuid, p_identity_state text, p_personal_state text, p_failure_class text default null)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare v_operator_id uuid;
begin
  if current_user not in ('service_role', 'postgres') then raise exception 'Trusted Entry operator service is required.' using errcode = '42501'; end if;
  if p_identity_state not in ('pending', 'invite_sent', 'existing_identity', 'identity_confirmed') or p_personal_state not in ('active', 'suspended', 'pending', 'failed') then raise exception 'Invalid operator admission lifecycle state.' using errcode = '22023'; end if;
  update entry_identity.personal_admission_requests set canonical_user_id = p_canonical_user_id, lifecycle_state = case when p_failure_class is null then 'completed' else 'failed' end, identity_state = p_identity_state, personal_state = case when p_personal_state = 'failed' then 'pending' else p_personal_state end, failure_class = case when p_failure_class is null then null else left(p_failure_class, 80) end, updated_at = now(), completed_at = case when p_failure_class is null then now() else null end where id = p_request_id returning operator_user_id into v_operator_id;
  if v_operator_id is null then raise exception 'Operator admission request not found.' using errcode = '22023'; end if;
  insert into entry_identity.operator_action_audit (operator_fingerprint, subject_fingerprint, request_fingerprint, action_type, outcome)
  values (entry_identity.operator_fingerprint(v_operator_id::text), case when p_canonical_user_id is null then null else entry_identity.operator_fingerprint(p_canonical_user_id::text) end, entry_identity.operator_fingerprint(p_request_id::text), case when p_failure_class is not null then 'personal_admission_failed' else 'personal_admission_completed' end, case when p_failure_class is not null then p_failure_class else p_identity_state || ':' || p_personal_state end);
  return true;
end;
$$;

create or replace function public.list_entry_personal_admissions()
returns table(request_fingerprint text, canonical_user_id uuid, identity_state text, personal_state text, lifecycle_state text)
language sql
stable
security invoker
set search_path = ''
as $$
  select entry_identity.operator_fingerprint(request.id::text), request.canonical_user_id, request.identity_state, request.personal_state, request.lifecycle_state
  from entry_identity.personal_admission_requests as request
  where current_user in ('service_role', 'postgres')
  order by request.updated_at desc
  limit 100;
$$;

create or replace function public.get_entry_personal_admission_subject(p_request_fingerprint text)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select request.canonical_user_id
  from entry_identity.personal_admission_requests as request
  where current_user in ('service_role', 'postgres')
    and entry_identity.operator_fingerprint(request.id::text) = p_request_fingerprint
    and request.canonical_user_id is not null;
$$;

create or replace function public.set_entry_personal_admission_state(p_request_fingerprint text, p_personal_state text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare v_canonical_user_id uuid; v_operator_user_id uuid;
begin
  if current_user not in ('service_role', 'postgres') then raise exception 'Trusted Entry operator service is required.' using errcode = '42501'; end if;
  if p_personal_state not in ('active', 'suspended') then raise exception 'Invalid Personal admission state.' using errcode = '22023'; end if;
  update entry_identity.personal_admission_requests
  set personal_state = p_personal_state, lifecycle_state = 'completed', failure_class = null, updated_at = now()
  where entry_identity.operator_fingerprint(id::text) = p_request_fingerprint returning canonical_user_id, operator_user_id into v_canonical_user_id, v_operator_user_id;
  if v_canonical_user_id is null then raise exception 'Personal admission subject is unavailable.' using errcode = '22023'; end if;
  insert into entry_identity.operator_action_audit (operator_fingerprint, subject_fingerprint, request_fingerprint, action_type, outcome)
  values (entry_identity.operator_fingerprint(v_operator_user_id::text), entry_identity.operator_fingerprint(v_canonical_user_id::text), p_request_fingerprint, case when p_personal_state = 'suspended' then 'personal_suspended' else 'personal_reactivated' end, upper(p_personal_state));
  return v_canonical_user_id;
end;
$$;

revoke all on function entry_identity.operator_fingerprint(text) from public, anon, authenticated;
revoke all on function public.get_my_entry_operator_status() from public, anon;
revoke all on function public.is_entry_operator_service(uuid) from public, anon, authenticated;
revoke all on function public.bootstrap_entry_operator(uuid, text) from public, anon, authenticated;
revoke all on function public.begin_entry_personal_admission(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_entry_personal_admission(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.list_entry_personal_admissions() from public, anon, authenticated;
revoke all on function public.get_entry_personal_admission_subject(text) from public, anon, authenticated;
revoke all on function public.set_entry_personal_admission_state(text, text) from public, anon, authenticated;
grant execute on function public.get_my_entry_operator_status() to authenticated;
grant execute on function public.is_entry_operator_service(uuid) to service_role;
grant execute on function public.bootstrap_entry_operator(uuid, text) to service_role;
grant execute on function public.begin_entry_personal_admission(uuid, uuid, text) to service_role;
grant execute on function public.complete_entry_personal_admission(uuid, uuid, text, text, text) to service_role;
grant execute on function public.list_entry_personal_admissions() to service_role;
grant execute on function public.get_entry_personal_admission_subject(text) to service_role;
grant execute on function public.set_entry_personal_admission_state(text, text) to service_role;

comment on function public.bootstrap_entry_operator(uuid, text) is 'One-time service-only Entry operator bootstrap. Do not use for routine operator changes.';
comment on function public.begin_entry_personal_admission(uuid, uuid, text) is 'Service-only, idempotent and rate-limited lifecycle command. It never writes entitlements.';

-- Forward-only: retain the existing job, schedule, owner and applied history.
-- Production prerequisite: configure entry_projection_drain_url in Vault first.
-- This does not make earlier migration replay safe without outbound isolation.
do $scheduler$
declare
  v_job_id bigint;
begin
  select jobid into strict v_job_id
  from cron.job
  where jobname = 'entry_personal_projection_outbox_drain';

  perform cron.alter_job(
    job_id := v_job_id,
    command := $command$
    do $drain$
    declare
      v_url text;
      v_secret text;
    begin
      v_url := (
        select btrim(decrypted_secret)
        from vault.decrypted_secrets
        where name = 'entry_projection_drain_url'
      );
      -- Require an HTTP(S) endpoint for this fixed route, without credentials,
      -- whitespace, query or fragment. Resolve no production fallback.
      if v_url is null or v_url !~ '^https?://[^/?#[:space:]@]+/api/internal/cron/personal-projection-drain$' then
        raise exception 'Projection drain endpoint is missing or has an unsupported format.'
          using errcode = '22023';
      end if;

      v_secret := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'cron_secret'
      );
      if nullif(btrim(v_secret), '') is null then
        raise exception 'Projection drain credential is not configured.'
          using errcode = '22023';
      end if;

      perform net.http_get(
        url := v_url,
        params := '{}'::jsonb,
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
        timeout_milliseconds := 10000
      );
    end;
    $drain$;
    $command$
  );
end;
$scheduler$;

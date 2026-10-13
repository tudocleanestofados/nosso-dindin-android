-- Keep each notification invisible to other workers while it is being sent.
alter table public.push_jobs add column if not exists claim_token uuid;
alter table public.push_jobs add column if not exists claimed_until timestamptz;
create index if not exists push_jobs_ready_idx on public.push_jobs(created_at,claimed_until) where sent_at is null and attempts<10;
create or replace function public.claim_push_jobs(p_worker uuid,p_limit int default 5)
returns setof public.push_jobs language sql security invoker set search_path='' as $$
 with ready as materialized (
  select id from public.push_jobs
  where sent_at is null and attempts<10 and (claimed_until is null or claimed_until<clock_timestamp()) and p_worker is not null
  order by created_at,id limit least(greatest(coalesce(p_limit,5),1),10)
  for update skip locked
 )
 update public.push_jobs j set claim_token=p_worker,claimed_until=clock_timestamp()+interval '10 minutes'
 from ready where j.id=ready.id returning j.*;
$$;
revoke all on function public.claim_push_jobs(uuid,int) from public,anon,authenticated;
grant execute on function public.claim_push_jobs(uuid,int) to service_role;

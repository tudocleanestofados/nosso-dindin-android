-- Execute with BEGIN/ROLLBACK. Triggered HTTP requests are rolled back too.
do $$
declare j uuid:=gen_random_uuid(); w1 uuid:=gen_random_uuid(); w2 uuid:=gen_random_uuid(); claimed uuid; affected int; g text;
begin
 select id into g from public.groups limit 1;
 insert into public.push_jobs(id,group_id,event_type,source_key,description,created_at)
 values(j,g,'test','TEST claim:'||j::text,'TEST queue claim','1990-01-01');
 select id into claimed from public.claim_push_jobs(w1,1) where id=j;
 if claimed is null then raise exception 'First worker did not claim'; end if;
 if exists(select 1 from public.claim_push_jobs(w2,1) where id=j) then raise exception 'Duplicate worker claimed same notification'; end if;
 update public.push_jobs set claimed_until=clock_timestamp()-interval '1 second' where id=j;
 select id into claimed from public.claim_push_jobs(w2,1) where id=j;
 if claimed is null then raise exception 'Expired claim could not retry'; end if;
 update public.push_jobs set sent_at=now() where id=j and claim_token=w1;
 get diagnostics affected=row_count;
 if affected<>0 then raise exception 'Stale worker could finish another claim'; end if;
 update public.push_jobs set sent_at=now(),claim_token=null,claimed_until=null where id=j and claim_token=w2;
 if exists(select 1 from public.claim_push_jobs(w1,1) where id=j) then raise exception 'Delivered job claimed again'; end if;
 if has_function_privilege('anon','public.claim_push_jobs(uuid,int)','execute') or has_function_privilege('authenticated','public.claim_push_jobs(uuid,int)','execute') then raise exception 'Client can claim queue'; end if;
 if not has_function_privilege('service_role','public.claim_push_jobs(uuid,int)','execute') then raise exception 'Server cannot claim queue'; end if;
end $$;
select 'passed: exclusive claim, expiry retry, stale worker fencing, delivered skip, server-only access' as result;

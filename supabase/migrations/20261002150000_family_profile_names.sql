-- Share only the display name of members in the caller's family.
create or replace function public.get_my_family_profiles(p_group_id text)
returns table(user_id uuid, email text, is_owner boolean, display_name text)
language sql stable security definer set search_path = '' as $function$
  select gm.user_id, u.email::text, (g.owner_id=gm.user_id),
    coalesce(nullif(btrim(u.raw_user_meta_data->>'display_name'),''),
             nullif(btrim(u.raw_user_meta_data->>'full_name'),''),
             nullif(btrim(u.raw_user_meta_data->>'name'),''))
  from public.group_members gm
  join public.groups g on g.id=gm.group_id
  join auth.users u on u.id=gm.user_id
  where gm.group_id=p_group_id
    and exists (select 1 from public.group_members me
                where me.group_id=p_group_id and me.user_id=(select auth.uid()))
  order by (g.owner_id=gm.user_id) desc, u.email;
$function$;
revoke all on function public.get_my_family_profiles(text) from public,anon;
grant execute on function public.get_my_family_profiles(text) to authenticated;

create or replace function public.enqueue_gsc_daily() returns integer
language plpgsql security definer set search_path=public as $$
declare rec record; day_here date:=(now() at time zone 'America/Recife')::date;
 time_here time:=(now() at time zone 'America/Recife')::time;
 state jsonb; left_amount numeric; msg text; inserted integer:=0;
begin
 for rec in
   select s.*,coalesce(nullif(btrim(u.raw_user_meta_data->>'display_name'),''),'Usuário') as name
   from public.gsc_settings s join auth.users u on u.id=s.user_id
   where s.notification_enabled and s.notification_time<=time_here
     and s.notification_time>time_here-interval '5 minutes'
 loop
  state:=public.gsc_balance(rec.group_id,rec.user_id,date_trunc('month',day_here)::date);
  left_amount:=(state->>'remaining')::numeric;
  if left_amount<=0 then msg:='Que pena, você já gastou todo o seu Gasto sem Culpa. Aguarde o próximo mês.';
  elsif left_amount<20 then msg:='Cuidado: restam R$ '||to_char(left_amount,'FM999999990D00')||' no seu Gasto sem Culpa.';
  else msg:='Você ainda tem R$ '||to_char(left_amount,'FM999999990D00')||' para gastar este mês. Lembre de gastar com sabedoria.'; end if;
  if rec.name<>'Usuário' then msg:=rec.name||', '||lower(left(msg,1))||substr(msg,2); end if;
  insert into public.push_jobs(group_id,target_user_id,event_type,source_key,description,amount,metadata)
  values(rec.group_id,rec.user_id,'gsc_daily','gsc:'||rec.user_id||':'||day_here,msg,left_amount,jsonb_build_object('title','Gasto sem Culpa'))
  on conflict(source_key) do nothing;
  if found then inserted:=inserted+1; end if;
 end loop;
 return inserted;
end $$;
revoke all on function public.enqueue_gsc_daily() from public,anon,authenticated;
grant execute on function public.enqueue_gsc_daily() to service_role;

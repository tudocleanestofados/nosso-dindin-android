-- Effective monthly values are separate from historical paid transactions.
create table nd_internal.recurring_amounts (
 series_id uuid references public.transactions(id) on delete cascade,
 from_month date not null,
 amount numeric not null check(amount>0),
 primary key(series_id,from_month)
);
alter table nd_internal.recurring_amounts enable row level security;
revoke all on nd_internal.recurring_amounts from public,anon,authenticated;
insert into nd_internal.recurring_amounts(series_id,from_month,amount)
select id,recurrence_month,amount from public.transactions where recurrence_series_id=id;
create or replace function nd_internal.extend_fixed_expense(p_root uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r public.transactions; m date; configured_amount numeric; anchor date; due date; n int; start_month date; horizon date;
begin
 select * into r from public.transactions where id=p_root and recurrence_series_id=id and fixed and type='expense' for update;
 if not found then return; end if;
 anchor:=r.recurrence_anchor; if anchor is null then return; end if;
 start_month:=r.recurrence_month;
 horizon:=greatest(start_month,date_trunc('month',now() at time zone 'America/Recife')::date)+interval '12 months';
 perform set_config('nd.recurrence_generation','on',true);
 for m in select generate_series(greatest(start_month+interval '1 month',date_trunc('month',now() at time zone 'America/Recife')),horizon,interval '1 month')::date loop
  if exists(select 1 from nd_internal.recurrence_exclusions where series_id=r.id and month=m) then continue; end if;
  select amount into configured_amount from nd_internal.recurring_amounts where series_id=r.id and from_month<=m order by from_month desc limit 1;
  due:=m+least(extract(day from anchor)::int,extract(day from(m+interval '1 month - 1 day'))::int)-1;
  insert into public.transactions(id,group_id,type,description,amount,category,account_id,date,due_date,paid,fixed,recurrence_series_id,recurrence_month)
  values(md5(r.id::text||':recurring:'||m::text)::uuid,r.group_id,'expense',r.description,coalesce(configured_amount,r.amount),r.category,null,due,due,false,true,r.id,m)
  on conflict do nothing;
 end loop;
 perform set_config('nd.recurrence_generation','off',true);
end $$;

create or replace function nd_internal.generate_fixed_expense() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.fixed and new.recurrence_series_id=new.id then
  insert into nd_internal.recurring_amounts(series_id,from_month,amount)
  values(new.id,new.recurrence_month,new.amount) on conflict do nothing;
  perform nd_internal.extend_fixed_expense(new.id);
 end if;
 return new;
end $$;
revoke all on function nd_internal.extend_fixed_expense(uuid), nd_internal.generate_fixed_expense() from public,anon,authenticated;

create or replace function public.update_my_transaction_with_recurrence(
 p_transaction_id uuid,p_group_id text,p_type text,p_description text,p_amount numeric,p_category text,
 p_account_id uuid,p_date date,p_due_date date,p_paid boolean,p_fixed boolean,p_scope text
) returns void language plpgsql security definer set search_path='' as $$
declare target public.transactions; root uuid; apply_month date;
begin
 if auth.uid() is null or not public.is_group_member(p_group_id) then raise exception 'Acesso negado'; end if;
 if p_scope is null or p_scope not in ('one','forward') then raise exception 'Opção inválida'; end if;
 select recurrence_series_id into root from public.transactions where id=p_transaction_id and group_id=p_group_id;
 if not found then raise exception 'Lançamento não encontrado'; end if;
 -- Use the same lock order as the automatic generator.
 if root is not null then perform 1 from public.transactions where id=root and group_id=p_group_id for update; end if;
 select * into target from public.transactions where id=p_transaction_id and group_id=p_group_id for update;
 if p_scope='forward' then
  if root is null or target.paid or p_type<>'expense' or not p_fixed or not exists(select 1 from public.transactions where id=root and group_id=p_group_id and fixed) then raise exception 'Escolha uma despesa fixa pendente com recorrência ativa'; end if;
  apply_month:=target.recurrence_month;
  if apply_month is null then raise exception 'Mês da recorrência inválido'; end if;
  if p_amount is null or round(p_amount,2)<=0 then raise exception 'Valor inválido'; end if;
  -- Replace any future amount changes: this edit applies from this month onward.
  delete from nd_internal.recurring_amounts where series_id=root and from_month>=apply_month;
  insert into nd_internal.recurring_amounts values(root,apply_month,round(p_amount,2));
 end if;
 perform public.update_my_transaction(p_transaction_id,p_group_id,p_type,p_description,round(p_amount,2),p_category,p_account_id,p_date,p_due_date,p_paid,p_fixed);
 if p_scope='forward' then
  update public.transactions set amount=round(p_amount,2)
  where group_id=p_group_id and recurrence_series_id=root and recurrence_month>=apply_month and not paid and id<>p_transaction_id;
 end if;
end $$;
revoke all on function public.update_my_transaction_with_recurrence(uuid,text,text,text,numeric,text,uuid,date,date,boolean,boolean,text) from public,anon;
grant execute on function public.update_my_transaction_with_recurrence(uuid,text,text,text,numeric,text,uuid,date,date,boolean,boolean,text) to authenticated;

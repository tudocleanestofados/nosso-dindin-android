-- Personal monthly allowance. All money movements stay in the existing ledger.
create table if not exists public.gsc_settings (
 group_id text not null references public.groups(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 account_id uuid references public.accounts(id) on delete set null,
 notification_time time not null default '09:00',
 notification_enabled boolean not null default true,
 primary key (group_id,user_id)
);
create table if not exists public.gsc_months (
 group_id text not null references public.groups(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 month date not null,
 amount numeric(14,2) not null check (amount >= 0),
 primary key (group_id,user_id,month),
 check (extract(day from month)=1)
);
create table if not exists public.gsc_expenses (
 group_id text not null references public.groups(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 transaction_id uuid unique references public.transactions(id) on delete cascade,
 installment_series_id uuid,
 purchase_id uuid unique references public.card_purchases(id) on delete cascade,
 created_at timestamptz not null default now(),
 check (num_nonnulls(transaction_id,installment_series_id,purchase_id)=1),
 unique (group_id,installment_series_id)
);
create index if not exists gsc_expenses_owner_idx on public.gsc_expenses(group_id,user_id);

alter table public.gsc_settings enable row level security;
alter table public.gsc_months enable row level security;
alter table public.gsc_expenses enable row level security;
create policy gsc_settings_read on public.gsc_settings for select to authenticated using
 (exists(select 1 from public.group_members gm where gm.group_id=gsc_settings.group_id and gm.user_id=auth.uid()));
create policy gsc_months_read on public.gsc_months for select to authenticated using
 (exists(select 1 from public.group_members gm where gm.group_id=gsc_months.group_id and gm.user_id=auth.uid()));
create policy gsc_expenses_read on public.gsc_expenses for select to authenticated using
 (exists(select 1 from public.group_members gm where gm.group_id=gsc_expenses.group_id and gm.user_id=auth.uid()));

create or replace function public.gsc_is_member(p_group text) returns boolean
language sql stable security definer set search_path=public as $$
 select auth.uid() is not null and exists(select 1 from public.group_members where group_id=p_group and user_id=auth.uid());
$$;
revoke all on function public.gsc_is_member(text) from public;
grant execute on function public.gsc_is_member(text) to authenticated;

create or replace function public.gsc_configure(p_group text,p_user uuid,p_month date,p_amount numeric,p_account uuid,p_time time,p_enabled boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.gsc_is_member(p_group) or not exists(select 1 from public.group_members where group_id=p_group and user_id=p_user) then
  raise exception 'Membro inválido'; end if;
 if p_month is null or extract(day from p_month)<>1 or p_amount is null or p_amount<0 or p_amount>100000000 or p_time is null then raise exception 'Confira mês, valor e horário'; end if;
 if p_account is not null and not exists(select 1 from public.accounts where id=p_account and group_id=p_group) then raise exception 'Conta inválida'; end if;
 insert into public.gsc_settings(group_id,user_id,account_id,notification_time,notification_enabled)
 values(p_group,p_user,p_account,p_time,p_enabled)
 on conflict(group_id,user_id) do update set account_id=excluded.account_id,notification_time=excluded.notification_time,notification_enabled=excluded.notification_enabled;
 insert into public.gsc_months(group_id,user_id,month,amount) values(p_group,p_user,p_month,p_amount)
 on conflict(group_id,user_id,month) do update set amount=excluded.amount;
end $$;
revoke all on function public.gsc_configure(text,uuid,date,numeric,uuid,time,boolean) from public;
grant execute on function public.gsc_configure(text,uuid,date,numeric,uuid,time,boolean) to authenticated;

create or replace function public.gsc_tag(p_group text,p_user uuid,p_transaction uuid default null,p_series uuid default null,p_purchase uuid default null)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.gsc_is_member(p_group) or not exists(select 1 from public.group_members where group_id=p_group and user_id=p_user) then raise exception 'Membro inválido'; end if;
 if num_nonnulls(p_transaction,p_series,p_purchase)<>1 then raise exception 'Escolha apenas uma despesa'; end if;
 if p_transaction is not null and not exists(select 1 from public.transactions where id=p_transaction and group_id=p_group and type='expense' and transfer_id is null) then raise exception 'Despesa inválida'; end if;
 if p_series is not null and not exists(select 1 from public.transactions where installment_series_id=p_series and group_id=p_group and type='expense') then raise exception 'Parcelamento inválido'; end if;
 if p_purchase is not null and not exists(select 1 from public.card_purchases where id=p_purchase and group_id=p_group) then raise exception 'Compra inválida'; end if;
 delete from public.gsc_expenses where group_id=p_group and (transaction_id=p_transaction or (p_series is not null and installment_series_id=p_series) or purchase_id=p_purchase);
 insert into public.gsc_expenses(group_id,user_id,transaction_id,installment_series_id,purchase_id)
 values(p_group,p_user,p_transaction,p_series,p_purchase);
end $$;
revoke all on function public.gsc_tag(text,uuid,uuid,uuid,uuid) from public;
grant execute on function public.gsc_tag(text,uuid,uuid,uuid,uuid) to authenticated;

-- Calculate one month from the first configured month, carrying only positive leftovers.
create or replace function public.gsc_balance(p_group text,p_user uuid,p_month date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare m date; first_month date; allocation numeric:=0; spent numeric:=0; carry numeric:=0; total numeric:=0; current_alloc numeric:=0; current_spent numeric:=0;
begin
 if auth.role()<>'service_role' and not public.gsc_is_member(p_group) then raise exception 'Acesso negado'; end if;
 if not exists(select 1 from public.group_members where group_id=p_group and user_id=p_user) then raise exception 'Membro inválido'; end if;
 if p_month is null or extract(day from p_month)<>1 then raise exception 'Mês inválido'; end if;
 select min(month) into first_month from public.gsc_months where group_id=p_group and user_id=p_user;
 if first_month is null or first_month>p_month then return jsonb_build_object('allocated',0,'spent',0,'carry',0,'remaining',0); end if;
 if p_month>first_month+interval '240 months' then raise exception 'Intervalo muito longo'; end if;
 for m in select generate_series(first_month,p_month,'1 month'::interval)::date loop
   select coalesce(sum(amount),0) into allocation from public.gsc_months where group_id=p_group and user_id=p_user and month=m;
   select coalesce(sum(x.amount),0) into spent from (
    select t.amount from public.gsc_expenses e join public.transactions t on
      (t.id=e.transaction_id or (e.installment_series_id is not null and t.installment_series_id=e.installment_series_id))
      and t.group_id=e.group_id
     where e.group_id=p_group and e.user_id=p_user and date_trunc('month',coalesce(t.due_date,t.date))::date=m
    union all
    select i.amount from public.gsc_expenses e join public.card_installments i on i.purchase_id=e.purchase_id and i.group_id=e.group_id
     where e.group_id=p_group and e.user_id=p_user and (i.invoice_month+interval '1 month')::date=m
   ) x;
   if m=p_month then current_alloc:=allocation; current_spent:=spent; total:=carry+allocation-spent;
   else carry:=greatest(0,carry+allocation-spent); end if;
 end loop;
 return jsonb_build_object('allocated',current_alloc,'spent',current_spent,'carry',carry,'remaining',total);
end $$;
revoke all on function public.gsc_balance(text,uuid,date) from public;
grant execute on function public.gsc_balance(text,uuid,date) to authenticated,service_role;

create or replace function public.reset_my_finance_data(p_group text,p_confirmation text)
returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not exists(select 1 from public.groups where id=p_group and owner_id=auth.uid()) then raise exception 'Somente o responsável pode zerar os dados'; end if;
 if p_confirmation<>'ZERAR DADOS' then raise exception 'Confirmação incorreta'; end if;
 delete from public.push_delivery_log where job_id in (select id from public.push_jobs where group_id=p_group);
 delete from public.push_jobs where group_id=p_group;
 delete from public.movement_events where group_id=p_group;
 delete from public.notification_log where group_id=p_group;
 delete from public.gsc_expenses where group_id=p_group;
 delete from public.gsc_months where group_id=p_group;
 delete from public.gsc_settings where group_id=p_group;
 delete from public.invoice_payments where group_id=p_group;
 delete from public.card_installments where group_id=p_group;
 delete from public.card_purchases where group_id=p_group;
 delete from public.goal_movements where group_id=p_group;
 delete from public.financial_goals where group_id=p_group;
 delete from public.transactions where group_id=p_group;
 delete from public.credit_cards where group_id=p_group;
 delete from public.accounts where group_id=p_group;
end $$;
revoke all on function public.reset_my_finance_data(text,text) from public;
grant execute on function public.reset_my_finance_data(text,text) to authenticated;

create or replace function public.enqueue_gsc_daily() returns integer
language plpgsql security definer set search_path=public as $$
declare rec record; day_here date:=(now() at time zone 'America/Recife')::date; time_here time:=(now() at time zone 'America/Recife')::time; state jsonb; left_amount numeric; msg text; inserted integer:=0;
begin
 for rec in select s.*,split_part(u.email,'@',1) as name from public.gsc_settings s join auth.users u on u.id=s.user_id
   where s.notification_enabled and s.notification_time<=time_here and s.notification_time>time_here-interval '5 minutes'
 loop
  state:=public.gsc_balance(rec.group_id,rec.user_id,date_trunc('month',day_here)::date);
  left_amount:=(state->>'remaining')::numeric;
  if left_amount<=0 then msg:='Que pena, você já gastou todo o seu Gasto sem Culpa. Aguarde o próximo mês.';
  elsif left_amount<20 then msg:='Cuidado: restam R$ '||to_char(left_amount,'FM999999990D00')||' no seu Gasto sem Culpa.';
  else msg:='Você ainda tem R$ '||to_char(left_amount,'FM999999990D00')||' para gastar este mês. Lembre de gastar com sabedoria.'; end if;
  insert into public.push_jobs(group_id,target_user_id,event_type,source_key,description,amount,metadata)
  values(rec.group_id,rec.user_id,'gsc_daily','gsc:'||rec.user_id||':'||day_here,msg,left_amount,jsonb_build_object('title','Gasto sem Culpa'))
  on conflict(source_key) do nothing;
  if found then inserted:=inserted+1; end if;
 end loop;
 return inserted;
end $$;
revoke all on function public.enqueue_gsc_daily() from public,anon,authenticated;
grant execute on function public.enqueue_gsc_daily() to service_role;
select cron.schedule('nosso-dindin-gsc-daily','*/5 * * * *','select public.enqueue_gsc_daily()');

-- Monthly expenses use deterministic IDs so retries never duplicate future months.
create schema if not exists nd_internal;
revoke all on schema nd_internal from public, anon, authenticated;
alter table public.transactions add column if not exists recurrence_series_id uuid;
alter table public.transactions add column if not exists recurrence_month date;
alter table public.transactions add column if not exists recurrence_anchor date;
create table nd_internal.recurrence_exclusions(series_id uuid references public.transactions(id) on delete cascade, month date, primary key(series_id,month));
alter table nd_internal.recurrence_exclusions enable row level security;
revoke all on nd_internal.recurrence_exclusions from public,anon,authenticated;
create unique index if not exists transactions_recurrence_month_key on public.transactions(recurrence_series_id, recurrence_month);

create or replace function nd_internal.extend_fixed_expense(p_root uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r public.transactions; m date; anchor date; due date; n int; start_month date; horizon date;
begin
 select * into r from public.transactions where id=p_root and recurrence_series_id=id and fixed and type='expense' for update;
 if not found then return; end if;
 anchor:=r.recurrence_anchor; if anchor is null then return; end if;
 start_month:=r.recurrence_month;
 horizon:=greatest(start_month,date_trunc('month',now() at time zone 'America/Recife')::date)+interval '12 months';
 perform set_config('nd.recurrence_generation','on',true);
 for m in select generate_series(greatest(start_month+interval '1 month',date_trunc('month',now() at time zone 'America/Recife')),horizon,interval '1 month')::date loop
  if exists(select 1 from nd_internal.recurrence_exclusions where series_id=r.id and month=m) then continue; end if;
  due:=m+least(extract(day from anchor)::int,extract(day from(m+interval '1 month - 1 day'))::int)-1;
  insert into public.transactions(id,group_id,type,description,amount,category,account_id,date,due_date,paid,fixed,recurrence_series_id,recurrence_month)
  values(md5(r.id::text||':recurring:'||m::text)::uuid,r.group_id,'expense',r.description,r.amount,r.category,null,due,due,false,true,r.id,m)
  on conflict do nothing;
 end loop;
 perform set_config('nd.recurrence_generation','off',true);
end $$;
revoke all on function nd_internal.extend_fixed_expense(uuid) from public,anon,authenticated;

create or replace function nd_internal.prepare_fixed_expense() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.fixed and new.type='expense' and new.recurrence_series_id is null and new.installment_series_id is null and new.transfer_id is null then
  new.recurrence_series_id:=new.id;
  new.recurrence_anchor:=coalesce(new.due_date,new.date);
  new.recurrence_month:=date_trunc('month',coalesce(new.due_date,new.date))::date;
 end if;
 return new;
end $$;
create or replace function nd_internal.generate_fixed_expense() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.fixed and new.recurrence_series_id=new.id then perform nd_internal.extend_fixed_expense(new.id); end if;
 return new;
end $$;
revoke all on function nd_internal.prepare_fixed_expense(),nd_internal.generate_fixed_expense() from public,anon,authenticated;
create trigger nd_prepare_fixed_expense before insert or update on public.transactions for each row execute function nd_internal.prepare_fixed_expense();
create trigger nd_generate_fixed_expense after insert or update on public.transactions for each row execute function nd_internal.generate_fixed_expense();
select cron.schedule('nosso-dindin-fixed-expenses','15 3 * * *', $cron$select nd_internal.extend_fixed_expense(id) from public.transactions where fixed and recurrence_series_id=id;$cron$);

-- Both pending and received income create distinct notifications. Generated
-- recurring months don't produce a burst of immediate notifications.
create or replace function public.enqueue_transaction_push() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); acc text; key text; kind text; bal numeric;
begin
 if current_setting('nd.recurrence_generation',true)='on' then return new; end if;
 select name into acc from public.accounts where id=new.account_id;
 if tg_op='INSERT' and not new.paid then
  kind:=case when new.type='income' then 'income_scheduled' else 'expense_scheduled' end;
  insert into public.push_jobs(group_id,actor_id,event_type,source_id,source_key,description,amount,account_name,balance_after,metadata)
  values(new.group_id,actor,kind,new.id,kind||':'||new.id::text,new.description,new.amount,acc,null,jsonb_build_object('due_date',coalesce(new.due_date::text,''),'category',coalesce(new.category,''))) on conflict(source_key) do nothing;
  return new;
 end if;
 if not new.paid then return new; end if;
 if tg_op='UPDATE' and coalesce(old.paid,false) then return new; end if;
 if new.category='Transferência' and new.transfer_id is not null then
  if new.type<>'expense' then return new; end if;
  kind:='transfer'; key:='transfer:'||new.transfer_id::text;
 else kind:=new.type; key:='transaction:'||new.id::text; bal:=public.get_group_available_balance_for_push(new.group_id); end if;
 insert into public.push_jobs(group_id,actor_id,event_type,source_id,source_key,description,amount,account_name,balance_after,metadata)
 values(new.group_id,actor,kind,new.id,key,new.description,new.amount,acc,bal,jsonb_build_object('due_date',coalesce(new.due_date::text,''),'transfer_id',new.transfer_id)) on conflict(source_key) do nothing;
 return new;
end $$;
revoke all on function public.enqueue_transaction_push() from public,anon,authenticated;

create or replace function public.save_my_existing_card_purchase_at_month(p_id uuid,p_group_id text,p_card_id uuid,p_description text,p_total_amount numeric,p_purchase_date date,p_category text,p_installments int,p_next_installment int,p_first_due_month date)
returns uuid language plpgsql security definer set search_path='' as $$
declare i int; base numeric; rem numeric; first_month date;
begin
 if auth.uid() is null or not public.is_group_member(p_group_id) then raise exception 'Acesso negado'; end if;
 if not exists(select 1 from public.credit_cards where id=p_card_id and group_id=p_group_id) then raise exception 'Cartão inválido'; end if;
 if p_installments is null or p_installments not between 1 and 120 or p_next_installment is null or p_next_installment not between 1 and p_installments or p_total_amount is null or p_total_amount<=0 or p_total_amount*100<p_installments or p_first_due_month is null or p_purchase_date is null or nullif(btrim(p_description),'') is null then raise exception 'Dados da compra inválidos'; end if;
 first_month:=(date_trunc('month',p_first_due_month)-interval '1 month')::date;
 if exists(select 1 from public.invoice_payments where card_id=p_card_id and invoice_month>=first_month and invoice_month<first_month+make_interval(months=>p_installments-p_next_installment+1)) then raise exception 'Escolha uma fatura que ainda não foi paga'; end if;
 insert into public.card_purchases(id,group_id,card_id,description,total_amount,purchase_date,category,installments)
 values(p_id,p_group_id,p_card_id,btrim(p_description),round(p_total_amount,2),p_purchase_date,nullif(btrim(p_category),''),p_installments);
 base:=trunc(round(p_total_amount,2)/p_installments,2); rem:=round(p_total_amount,2)-base*p_installments;
 for i in p_next_installment..p_installments loop
  insert into public.card_installments(id,group_id,purchase_id,card_id,installment_number,amount,invoice_month,paid)
  values(gen_random_uuid(),p_group_id,p_id,p_card_id,i,base+case when i=p_installments then rem else 0 end,(first_month+make_interval(months=>i-p_next_installment))::date,false);
 end loop;
 return p_id;
end $$;
-- Compatibility for apps which still send current/next: invoice_month is the
-- month BEFORE the due month, regardless of the original purchase date.
create or replace function public.save_my_existing_card_purchase(p_id uuid,p_group_id text,p_card_id uuid,p_description text,p_total_amount numeric,p_purchase_date date,p_category text,p_installments int,p_next_installment int,p_first_invoice text)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 if p_first_invoice is null or p_first_invoice not in ('current','next') then raise exception 'Fatura inicial inválida'; end if;
 return public.save_my_existing_card_purchase_at_month(p_id,p_group_id,p_card_id,p_description,p_total_amount,p_purchase_date,p_category,p_installments,p_next_installment,(date_trunc('month',now() at time zone 'America/Recife')+case when p_first_invoice='next' then interval '1 month' else interval '0 months' end)::date);
end $$;

create or replace function public.edit_my_card_installments(p_group_id text,p_purchase_id uuid,p_installment_id uuid,p_scope text,p_card_id uuid,p_description text,p_category text,p_purchase_date date,p_amount numeric,p_next_number int,p_total int,p_due_month date)
returns void language plpgsql security definer set search_path='' as $$
declare p public.card_purchases; chosen public.card_installments; first_month date; n int; kept_max int; kept_count int; kept_total numeric;
begin
 if auth.uid() is null or not public.is_group_member(p_group_id) then raise exception 'Acesso negado'; end if;
 select * into p from public.card_purchases where id=p_purchase_id and group_id=p_group_id for update;
 if not found then raise exception 'Compra não encontrada'; end if;
 perform 1 from public.card_installments where purchase_id=p.id for update;
 select * into chosen from public.card_installments where id=p_installment_id and purchase_id=p.id and not paid;
 if not found then raise exception 'Selecione uma parcela pendente'; end if;
 if p_scope is null or p_scope not in ('one','remaining') or p_amount is null or round(p_amount,2)<=0 or p_total is null or p_total not between 1 and 120 or p_next_number is null or p_next_number not between 1 and p_total or p_due_month is null or p_purchase_date is null or nullif(btrim(p_description),'') is null then raise exception 'Dados inválidos'; end if;
 if not exists(select 1 from public.credit_cards where id=p_card_id and group_id=p_group_id) then raise exception 'Cartão inválido'; end if;
 if p_card_id<>p.card_id and (p_scope='one' or exists(select 1 from public.card_installments where purchase_id=p.id and (paid or installment_number<chosen.installment_number))) then raise exception 'Só é possível trocar o cartão de todas as parcelas de uma compra sem pagamentos'; end if;
 first_month:=(date_trunc('month',p_due_month)-interval '1 month')::date;
 if p_scope='one' then
  if p_total<>p.installments or p_next_number<>chosen.installment_number then raise exception 'Para mudar a numeração, escolha esta parcela e as seguintes'; end if;
  if exists(select 1 from public.invoice_payments where card_id=p_card_id and invoice_month=first_month) then raise exception 'A fatura de destino já foi paga'; end if;
  update public.card_installments set amount=round(p_amount,2),invoice_month=first_month where id=chosen.id;
  update public.card_purchases set total_amount=round(total_amount-chosen.amount+p_amount,2),description=btrim(p_description),category=nullif(btrim(p_category),''),purchase_date=p_purchase_date where id=p.id;
 else
  select coalesce(max(installment_number),0),count(*),coalesce(sum(amount),0) into kept_max,kept_count,kept_total from public.card_installments where purchase_id=p.id and (paid or installment_number<chosen.installment_number);
  if p_next_number<=kept_max then raise exception 'A numeração não pode sobrepor parcelas preservadas'; end if;
  if exists(select 1 from public.invoice_payments where card_id=p_card_id and invoice_month>=first_month and invoice_month<first_month+make_interval(months=>p_total-p_next_number+1)) then raise exception 'Uma das faturas de destino já foi paga'; end if;
  delete from public.card_installments where purchase_id=p.id and not paid and installment_number>=chosen.installment_number;
  for n in p_next_number..p_total loop
   insert into public.card_installments(id,group_id,purchase_id,card_id,installment_number,amount,invoice_month,paid)
   values(gen_random_uuid(),p_group_id,p.id,p_card_id,n,round(p_amount,2),(first_month+make_interval(months=>n-p_next_number))::date,false);
  end loop;
  update public.card_purchases set card_id=p_card_id,description=btrim(p_description),category=nullif(btrim(p_category),''),purchase_date=p_purchase_date,installments=p_total,total_amount=kept_total+round(p_amount,2)*(p_total-kept_count) where id=p.id;
 end if;
end $$;

create or replace function public.delete_my_card_installments(p_group_id text,p_purchase_id uuid,p_installment_id uuid,p_scope text)
returns int language plpgsql security definer set search_path='' as $$
declare chosen public.card_installments; removed numeric; result int;
begin
 if auth.uid() is null or not public.is_group_member(p_group_id) then raise exception 'Acesso negado'; end if;
 perform 1 from public.card_purchases where id=p_purchase_id and group_id=p_group_id for update;
 if not found then raise exception 'Compra não encontrada'; end if;
 perform 1 from public.card_installments where purchase_id=p_purchase_id for update;
 select * into chosen from public.card_installments where id=p_installment_id and purchase_id=p_purchase_id and not paid;
 if not found then raise exception 'Selecione uma parcela pendente'; end if;
 if p_scope is null or p_scope not in ('one','remaining') then raise exception 'Opção inválida'; end if;
 select sum(amount) into removed from public.card_installments where purchase_id=p_purchase_id and not paid and (id=chosen.id or (p_scope='remaining' and installment_number>=chosen.installment_number));
 delete from public.card_installments where purchase_id=p_purchase_id and not paid and (id=chosen.id or (p_scope='remaining' and installment_number>=chosen.installment_number));
 get diagnostics result=row_count;
 if not exists(select 1 from public.card_installments where purchase_id=p_purchase_id) then delete from public.card_purchases where id=p_purchase_id;
 else update public.card_purchases set total_amount=greatest(0,total_amount-removed) where id=p_purchase_id; end if;
 return result;
end $$;
revoke all on function public.save_my_existing_card_purchase_at_month(uuid,text,uuid,text,numeric,date,text,int,int,date),public.save_my_existing_card_purchase(uuid,text,uuid,text,numeric,date,text,int,int,text),public.edit_my_card_installments(text,uuid,uuid,text,uuid,text,text,date,numeric,int,int,date),public.delete_my_card_installments(text,uuid,uuid,text) from public,anon;
grant execute on function public.save_my_existing_card_purchase_at_month(uuid,text,uuid,text,numeric,date,text,int,int,date),public.save_my_existing_card_purchase(uuid,text,uuid,text,numeric,date,text,int,int,text),public.edit_my_card_installments(text,uuid,uuid,text,uuid,text,text,date,numeric,int,int,date),public.delete_my_card_installments(text,uuid,uuid,text) to authenticated;

create or replace function nd_internal.exclude_deleted_recurrence() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.recurrence_series_id is not null and old.id<>old.recurrence_series_id and exists(select 1 from public.transactions where id=old.recurrence_series_id) then
  insert into nd_internal.recurrence_exclusions values(old.recurrence_series_id,old.recurrence_month) on conflict do nothing;

 end if;
 return old;
end $$;
revoke all on function nd_internal.exclude_deleted_recurrence() from public,anon,authenticated;
create trigger nd_exclude_deleted_recurrence after delete on public.transactions for each row execute function nd_internal.exclude_deleted_recurrence();

-- Activate existing standalone fixed expenses once, preserving their original
-- rows and suppressing immediate notifications for generated future months.
update public.transactions set fixed=fixed
where fixed and type='expense' and recurrence_series_id is null and installment_series_id is null and transfer_id is null;

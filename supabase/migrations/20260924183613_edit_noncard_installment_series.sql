-- Identity for ordinary installment series; existing individual transactions stay intact.
alter table public.transactions
  add column if not exists installment_series_id uuid,
  add column if not exists installment_number integer,
  add column if not exists installment_total integer;

create index if not exists transactions_installment_series_idx
  on public.transactions (group_id, installment_series_id, installment_number)
  where installment_series_id is not null;

-- Backfill only numbered, unpaid series created together in a single batch.
with numbered as (
  select t.id, t.group_id, t.created_at,
         regexp_replace(t.description, ' \([0-9]+/[0-9]+\)$', '') as base,
         (regexp_match(t.description, ' \(([0-9]+)/([0-9]+)\)$'))[1]::integer as num,
         (regexp_match(t.description, ' \(([0-9]+)/([0-9]+)\)$'))[2]::integer as total
  from public.transactions t
  where t.type = 'expense' and not t.paid and t.account_id is null
    and t.description ~ ' \([0-9]+/[0-9]+\)$'
), batches as (
  select group_id, created_at, base, total, gen_random_uuid() as series_id
  from numbered
  where total between 2 and 120 and num between 1 and total
  group by group_id, created_at, base, total
  having count(*) >= 2 and count(distinct num) = count(*)
)
update public.transactions t
set installment_series_id = b.series_id,
    installment_number = n.num,
    installment_total = n.total
from numbered n join batches b on b.group_id = n.group_id
  and b.created_at = n.created_at and b.base = n.base and b.total = n.total
where t.id = n.id and t.installment_series_id is null;

-- Creates all remaining ordinary expense installments atomically, without a card.
create or replace function public.create_my_noncard_installments(
  p_group_id text,
  p_series_id uuid,
  p_description text,
  p_category text,
  p_amount_cents integer,
  p_amount_mode text,
  p_installments integer,
  p_next_installment integer,
  p_first_due date,
  p_last_amount_cents integer default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  uid uuid := auth.uid();
  n integer;
  this_amount integer;
  target_month date;
  due_day integer;
  due_date date;
  inserted_count integer := 0;
  inserted_one integer;
begin
  if uid is null or not exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = uid
  ) then
    raise exception 'Acesso negado';
  end if;
  if p_series_id is null or p_installments is null or p_installments not between 2 and 120
     or p_next_installment is null or p_next_installment not between 1 and p_installments
     or p_first_due is null or nullif(btrim(p_description), '') is null
     or p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 100000000
     or p_amount_mode is null or p_amount_mode not in ('total', 'each')
     or (p_amount_mode = 'total' and (p_next_installment <> 1 or p_amount_cents < p_installments or p_last_amount_cents is not null))
     or (p_last_amount_cents is not null and (p_amount_mode <> 'each' or p_last_amount_cents <= 0 or p_last_amount_cents > 100000000))
  then
    raise exception 'Dados do parcelamento inválidos';
  end if;

  due_day := extract(day from p_first_due)::integer;
  for n in p_next_installment..p_installments loop
    target_month := (date_trunc('month', p_first_due::timestamp)
      + make_interval(months => n - p_next_installment))::date;
    due_date := make_date(
      extract(year from target_month)::integer,
      extract(month from target_month)::integer,
      least(due_day, extract(day from (target_month + interval '1 month - 1 day'))::integer)
    );
    this_amount := case
      when p_amount_mode = 'each' then
        case when n = p_installments then coalesce(p_last_amount_cents, p_amount_cents) else p_amount_cents end
      else (p_amount_cents / p_installments) +
        case when n = p_installments then p_amount_cents % p_installments else 0 end
    end;

    insert into public.transactions (
      id, group_id, type, description, amount, category,
      account_id, date, due_date, paid, fixed,
      installment_series_id, installment_number, installment_total
    ) values (
      md5(p_series_id::text || ':' || n::text)::uuid,
      p_group_id, 'expense', btrim(p_description) || ' (' || n || '/' || p_installments || ')',
      this_amount::numeric / 100, nullif(btrim(p_category), ''),
      null, due_date, due_date, false, false,
      p_series_id, n, p_installments
    ) on conflict (id) do nothing;
    get diagnostics inserted_one = row_count;
    inserted_count := inserted_count + inserted_one;
  end loop;
  return inserted_count;
end
$function$;

revoke all on function public.create_my_noncard_installments(
  text, uuid, text, text, integer, text, integer, integer, date, integer
) from public, anon;
grant execute on function public.create_my_noncard_installments(
  text, uuid, text, text, integer, text, integer, integer, date, integer
) to authenticated;

-- Changes only unpaid installments whose due dates have not passed.
create or replace function public.update_my_noncard_installment_series(
  p_group_id text,
  p_series_id uuid,
  p_description text,
  p_category text,
  p_amount_cents integer,
  p_first_due date,
  p_last_amount_cents integer default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  first_number integer;
  row_item record;
  target_month date;
  v_due_date date;
  due_day integer;
  value_cents integer;
  changed integer := 0;
begin
  if auth.uid() is null or not exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = auth.uid()
  ) then
    raise exception 'Acesso negado';
  end if;
  if p_series_id is null or nullif(btrim(p_description), '') is null
     or p_amount_cents is null or p_amount_cents not between 1 and 100000000
     or p_first_due is null or p_first_due < current_date
     or (p_last_amount_cents is not null and p_last_amount_cents not between 1 and 100000000)
  then
    raise exception 'Dados inválidos para editar o parcelamento';
  end if;

  select min(t.installment_number) into first_number
  from public.transactions t
  where t.group_id = p_group_id and t.installment_series_id = p_series_id
    and t.type = 'expense' and not t.paid and t.due_date >= current_date;
  if first_number is null then
    raise exception 'Nenhuma parcela futura pendente neste acordo';
  end if;

  due_day := extract(day from p_first_due)::integer;
  for row_item in
    select t.id, t.installment_number, t.installment_total
    from public.transactions t
    where t.group_id = p_group_id and t.installment_series_id = p_series_id
      and t.type = 'expense' and not t.paid and t.due_date >= current_date
    order by t.installment_number
    for update
  loop
    target_month := (date_trunc('month', p_first_due::timestamp)
      + make_interval(months => row_item.installment_number - first_number))::date;
    v_due_date := make_date(
      extract(year from target_month)::integer,
      extract(month from target_month)::integer,
      least(due_day, extract(day from (target_month + interval '1 month - 1 day'))::integer)
    );
    value_cents := case when row_item.installment_number = row_item.installment_total
      then coalesce(p_last_amount_cents, p_amount_cents) else p_amount_cents end;
    update public.transactions t
    set description = btrim(p_description) || ' (' || row_item.installment_number || '/' || row_item.installment_total || ')',
        category = nullif(btrim(p_category), ''),
        amount = value_cents::numeric / 100,
        date = v_due_date,
        due_date = v_due_date
    where t.id = row_item.id;
    changed := changed + 1;
  end loop;
  return changed;
end
$function$;

revoke all on function public.update_my_noncard_installment_series(
  text, uuid, text, text, integer, date, integer
) from public, anon;
grant execute on function public.update_my_noncard_installment_series(
  text, uuid, text, text, integer, date, integer
) to authenticated;

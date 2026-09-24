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
      account_id, date, due_date, paid, fixed
    ) values (
      md5(p_series_id::text || ':' || n::text)::uuid,
      p_group_id, 'expense', btrim(p_description) || ' (' || n || '/' || p_installments || ')',
      this_amount::numeric / 100, nullif(btrim(p_category), ''),
      null, due_date, due_date, false, false
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

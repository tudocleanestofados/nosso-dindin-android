-- Execute inside BEGIN/ROLLBACK, after the migration. No real data is retained.
do $$
declare g text; u uuid; root uuid:=gen_random_uuid(); feb uuid; mar uuid; last_row uuid; n int;
begin
 select group_id,user_id into g,u from public.group_members limit 1;
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 perform public.save_my_transaction(root,g,'expense','TEST recurring amount',10,'Outros',null,'2030-01-31','2030-01-31',false,true);
 perform public.update_my_transaction_with_recurrence(root,g,'expense','TEST recurring amount',12,'Outros',null,'2030-01-31','2030-01-31',false,true,'one');
 if (select amount from nd_internal.recurring_amounts where series_id=root and from_month='2030-01-01')<>10 then raise exception 'Single root edit changed recurring default'; end if;
 if (select amount from public.transactions where recurrence_series_id=root and recurrence_month='2030-02-01')<>10 then raise exception 'Single root edit changed next month'; end if;
 select id into feb from public.transactions where recurrence_series_id=root and recurrence_month='2030-02-01';
 select id into mar from public.transactions where recurrence_series_id=root and recurrence_month='2030-03-01';
 update public.transactions set paid=true,account_id=(select id from public.accounts where group_id=g limit 1) where id=mar;
 perform public.update_my_transaction_with_recurrence(feb,g,'expense','TEST recurring amount',20,'Outros',null,'2030-02-28','2030-02-28',false,true,'forward');
 if (select amount from public.transactions where id=root)<>12 then raise exception 'Earlier month changed'; end if;
 if (select amount from public.transactions where id=mar)<>10 then raise exception 'Paid month changed'; end if;
 if exists(select 1 from public.transactions where recurrence_series_id=root and recurrence_month>='2030-02-01' and not paid and amount<>20) then raise exception 'Future amounts were not updated'; end if;
 perform public.update_my_transaction_with_recurrence(feb,g,'expense','TEST recurring amount',25,'Outros',null,'2030-02-28','2030-02-28',false,true,'one');
 if (select amount from public.transactions where recurrence_series_id=root and recurrence_month='2030-04-01')<>20 then raise exception 'Single child edit changed next month'; end if;
 select id into last_row from public.transactions where recurrence_series_id=root and recurrence_month='2031-01-01';
 delete from public.transactions where id=last_row;
 delete from nd_internal.recurrence_exclusions where series_id=root and month='2031-01-01';
 perform nd_internal.extend_fixed_expense(root);
 if (select amount from public.transactions where id=last_row)<>20 then raise exception 'Newly generated month did not use configured amount'; end if;
 begin
  perform public.update_my_transaction_with_recurrence(mar,g,'expense','TEST recurring amount',99,'Outros',null,'2030-03-31','2030-03-31',false,true,'forward');
  raise exception 'Paid forward edit allowed';
 exception when others then if sqlerrm='Paid forward edit allowed' then raise; end if; end;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin
  perform public.update_my_transaction_with_recurrence(feb,g,'expense','TEST recurring amount',99,'Outros',null,'2030-02-28','2030-02-28',false,true,'forward');
  raise exception 'Unauthorized recurring edit allowed';
 exception when others then if sqlerrm='Unauthorized recurring edit allowed' then raise; end if; end;
 if has_function_privilege('anon','public.update_my_transaction_with_recurrence(uuid,text,text,text,numeric,text,uuid,date,date,boolean,boolean,text)','execute') then raise exception 'Anon exposed'; end if;
end $$;
select 'passed: one month, future months, paid preservation, future generation and authorization' as result;

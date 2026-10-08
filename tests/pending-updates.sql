-- Run inside BEGIN/ROLLBACK; leaves no financial rows or notification requests.
do $$
declare g text; u uuid; card uuid:=gen_random_uuid(); root uuid:=gen_random_uuid(); inc uuid:=gen_random_uuid(); purchase uuid:=gen_random_uuid(); item uuid; deleted uuid; cnt int;
begin
 select gm.group_id,gm.user_id into g,u from public.group_members gm limit 1;
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 perform public.save_my_transaction(root,g,'expense','TEST recurring',10,'Outros',null,'2026-10-31','2026-10-31',false,true);
 select count(*) into cnt from public.transactions where recurrence_series_id=root;
 if cnt<>13 then raise exception 'Recurring expected 13 got %',cnt; end if;
 if not exists(select 1 from public.transactions where recurrence_series_id=root and due_date='2027-02-28') or not exists(select 1 from public.transactions where recurrence_series_id=root and due_date='2027-03-31') then raise exception 'Month-end clamping failed'; end if;
 select count(*) into cnt from public.push_jobs where source_id in(select id from public.transactions where recurrence_series_id=root);
 if cnt<>1 then raise exception 'Generated recurring notification burst: %',cnt; end if;
 perform nd_internal.extend_fixed_expense(root);
 if (select count(*) from public.transactions where recurrence_series_id=root)<>13 then raise exception 'Recurring duplicate'; end if;
 select id into deleted from public.transactions where recurrence_series_id=root and recurrence_month='2026-11-01';
 delete from public.transactions where id=deleted;
 perform nd_internal.extend_fixed_expense(root);
 if exists(select 1 from public.transactions where id=deleted) then raise exception 'Deleted month recreated'; end if;

 perform public.save_my_transaction(inc,g,'income','TEST income',12,'Salário',null,'2026-10-08','2026-10-20',false,false);
 if not exists(select 1 from public.push_jobs where source_id=inc and event_type='income_scheduled') then raise exception 'Pending income missing notification'; end if;
 update public.transactions set paid=true,account_id=(select id from public.accounts where group_id=g limit 1) where id=inc;
 if not exists(select 1 from public.push_jobs where source_id=inc and event_type='income') then raise exception 'Received income missing notification'; end if;
 if (select count(*) from public.push_jobs where source_id=inc)<>2 then raise exception 'Income notification count'; end if;

 insert into public.credit_cards(id,group_id,name,credit_limit,closing_day,due_day) values(card,g,'TEST card',10000,8,15);
 perform public.save_my_existing_card_purchase(purchase,g,card,'TEST ongoing',90,'2026-05-01','Outros',9,6,'current');
 if not exists(select 1 from public.card_installments where purchase_id=purchase and installment_number=6 and invoice_month='2026-09-01') then raise exception 'Current invoice offset'; end if;
 select id into item from public.card_installments where purchase_id=purchase and installment_number=6;
 perform public.edit_my_card_installments(g,purchase,item,'remaining',card,'TEST corrected','Outros','2026-05-02',10,6,9,'2026-10-01');
 if not exists(select 1 from public.card_installments where purchase_id=purchase and installment_number=9 and invoice_month='2026-12-01') then raise exception 'Remaining invoice sequence'; end if;
 update public.card_installments set paid=true where purchase_id=purchase and installment_number=6;
 select id into item from public.card_installments where purchase_id=purchase and installment_number=7;
 perform public.edit_my_card_installments(g,purchase,item,'remaining',card,'TEST corrected','Outros','2026-05-02',11,7,10,'2026-11-01');
 if not exists(select 1 from public.card_installments where purchase_id=purchase and installment_number=6 and paid and amount=10 and invoice_month='2026-09-01') then raise exception 'Paid installment changed'; end if;
 select id into item from public.card_installments where purchase_id=purchase and installment_number=8;
 perform public.edit_my_card_installments(g,purchase,item,'one',card,'TEST corrected','Outros','2026-05-02',12,8,10,'2026-12-01');
 if (select amount from public.card_installments where purchase_id=purchase and installment_number=7)<>11 then raise exception 'Single edit changed neighbor'; end if;
 perform public.delete_my_card_installments(g,purchase,item,'one');
 if exists(select 1 from public.card_installments where id=item) then raise exception 'Single deletion failed'; end if;
 select id into item from public.card_installments where purchase_id=purchase and installment_number=7;
 perform public.delete_my_card_installments(g,purchase,item,'remaining');
 if (select count(*) from public.card_installments where purchase_id=purchase)<>1 then raise exception 'Delete remaining failed'; end if;
 if not exists(select 1 from public.card_installments where purchase_id=purchase and paid) then raise exception 'Deleted paid installment'; end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin
  perform public.delete_my_card_installments(g,purchase,item,'remaining');
  raise exception 'Unauthorized call was allowed';
 exception when others then
  if sqlerrm='Unauthorized call was allowed' then raise; end if;
 end;
 if has_function_privilege('anon','public.edit_my_card_installments(text,uuid,uuid,text,uuid,text,text,date,numeric,int,int,date)','execute') then raise exception 'Anon execute exposed'; end if;
end $$;
select 'passed: recurrence, month-end, retries, deletion, pending/received income, invoice offset, card editing/deletion, paid preservation, access control' as result;

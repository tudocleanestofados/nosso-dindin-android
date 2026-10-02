-- RLS still limits rows to members of the family; the API role needs table access.
grant select on public.gsc_settings, public.gsc_months, public.gsc_expenses to authenticated;
drop policy gsc_settings_read on public.gsc_settings;
drop policy gsc_months_read on public.gsc_months;
drop policy gsc_expenses_read on public.gsc_expenses;
create policy gsc_settings_read on public.gsc_settings for select to authenticated using (public.gsc_is_member(group_id));
create policy gsc_months_read on public.gsc_months for select to authenticated using (public.gsc_is_member(group_id));
create policy gsc_expenses_read on public.gsc_expenses for select to authenticated using (public.gsc_is_member(group_id));

-- RLS still limits rows to members of the family; the API role needs table access.
grant select on public.gsc_settings, public.gsc_months, public.gsc_expenses to authenticated;

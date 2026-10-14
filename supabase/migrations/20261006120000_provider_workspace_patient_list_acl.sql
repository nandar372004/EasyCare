begin;

revoke all on function public.list_my_clinical_patients() from public, anon;
grant execute on function public.list_my_clinical_patients() to authenticated;

commit;

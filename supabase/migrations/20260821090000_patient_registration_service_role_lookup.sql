begin;

-- patient-register performs only this duplicate-phone lookup directly.
-- Registration inserts remain encapsulated by the SECURITY DEFINER RPC.
grant select (id, primary_phone) on table public.patients to service_role;

-- Preserve the existing server-only RPC boundary explicitly.
revoke all on function public.create_patient_registration(jsonb) from public;
grant execute on function public.create_patient_registration(jsonb) to service_role;

commit;

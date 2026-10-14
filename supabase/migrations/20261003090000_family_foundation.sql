begin;

-- Membership is administrative metadata, never an input to clinical RLS.
create table public.family_groups (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(btrim(display_name)) between 1 and 100),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);
create table public.family_group_members (
  id uuid primary key default gen_random_uuid(),
  family_group_id uuid not null references public.family_groups(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  relationship text not null check (relationship in ('self','spouse','mother','father','parent','child','sibling','guardian','dependent','other')),
  role text not null check (role in ('owner','member')),
  status text not null default 'active' check (status in ('active','removed')),
  added_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  joined_at timestamptz not null default statement_timestamp(),
  removed_at timestamptz,
  unique(family_group_id,patient_id),
  check ((status='removed')=(removed_at is not null)),
  check (role <> 'owner' or (relationship='self' and status='active'))
);
create unique index family_group_owner_idx on public.family_group_members(family_group_id) where role='owner';
create index family_groups_creator_idx on public.family_groups(created_by);
create index family_group_members_patient_idx on public.family_group_members(patient_id,status,family_group_id);

-- A recipient creates a random one-use code. No phone/email/patient search.
create table public.family_join_codes (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default (statement_timestamp()+interval '24 hours'),
  consumed_at timestamptz,
  check (expires_at > created_at)
);
create index family_join_codes_creator_idx on public.family_join_codes(created_by);
create table public.family_invitations (
  id uuid primary key default gen_random_uuid(),
  family_group_id uuid not null references public.family_groups(id) on delete restrict,
  invited_profile_id uuid not null references public.profiles(id) on delete restrict,
  invited_by uuid not null references public.profiles(id) on delete restrict,
  relationship text not null check (relationship in ('spouse','mother','father','parent','child','sibling','guardian','other')),
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default (statement_timestamp()+interval '7 days'),
  responded_at timestamptz,
  check (invited_profile_id <> invited_by),
  check (expires_at > created_at),
  check ((status='pending')=(responded_at is null))
);
create index family_invitations_recipient_idx on public.family_invitations(invited_profile_id,status,expires_at);
create index family_invitations_group_idx on public.family_invitations(family_group_id,status);
create index family_invitations_sender_idx on public.family_invitations(invited_by);

alter table public.family_authorizations
  add column expires_at timestamptz,
  add column revoked_by uuid references public.profiles(id) on delete restrict,
  add column source_family_group_id uuid references public.family_groups(id) on delete restrict,
  add column consent_id uuid;
alter table public.consents add constraint consents_id_patient_key unique(id,patient_id);
alter table public.family_authorizations add constraint family_authorizations_consent_patient_fk
  foreign key(consent_id,patient_id) references public.consents(id,patient_id) on delete restrict;
alter table public.family_authorizations add constraint family_authorization_lifecycle_check check (
  (expires_at is null or isfinite(expires_at)) and
  (revoked_by is null or status='revoked') and
  (source_family_group_id is null or (consent_id is not null and authorized_at is not null and expires_at is not null and expires_at>authorized_at))
);
create index family_authorizations_source_group_idx on public.family_authorizations(source_family_group_id) where source_family_group_id is not null;
create index family_authorizations_consent_idx on public.family_authorizations(consent_id) where consent_id is not null;
create index family_authorizations_revoker_idx on public.family_authorizations(revoked_by) where revoked_by is not null;

create function public.require_family_patient() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare result uuid;
begin
  select p.id into result from public.patients p join public.profiles pr on pr.id=p.profile_id
    where p.auth_user_id=auth.uid() and p.status='active' and pr.status='active' and pr.role='patient'
      and p.date_of_birth <= (current_date-interval '18 years')::date;
  if result is null then raise exception 'An active adult patient account is required' using errcode='42501'; end if;
  return result;
end $$;
revoke all on function public.require_family_patient() from public, anon, authenticated;

create function public.is_family_group_member(p_group_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.family_group_members m join public.patients p on p.id=m.patient_id
    join public.profiles pr on pr.id=p.profile_id
    where m.family_group_id=p_group_id and m.status='active' and p.auth_user_id=auth.uid()
      and p.status='active' and pr.status='active')
$$;
revoke all on function public.is_family_group_member(uuid) from public, anon;
grant execute on function public.is_family_group_member(uuid) to authenticated;

alter table public.family_groups enable row level security;
alter table public.family_group_members enable row level security;
alter table public.family_join_codes enable row level security;
alter table public.family_invitations enable row level security;
create policy family_groups_read on public.family_groups for select to authenticated using (public.is_family_group_member(id));
create policy family_members_read on public.family_group_members for select to authenticated using (public.is_family_group_member(family_group_id));
create policy family_codes_read on public.family_join_codes for select to authenticated using (created_by=auth.uid());
create policy family_invites_read on public.family_invitations for select to authenticated using (invited_profile_id=auth.uid() or invited_by=auth.uid());
-- Only audited, identity-resolving RPCs write; no forgeable direct mutations.
revoke all on public.family_groups, public.family_group_members, public.family_join_codes, public.family_invitations from public, anon, authenticated;
grant select on public.family_groups, public.family_group_members, public.family_invitations to authenticated;
grant all on public.family_groups, public.family_group_members, public.family_join_codes, public.family_invitations to service_role;
revoke insert, update, delete on public.family_authorizations from public, anon, authenticated;

create trigger family_groups_updated before update on public.family_groups for each row execute function public.set_updated_at();
create trigger family_groups_audit after insert or update or delete on public.family_groups for each row execute function public.audit_row_change();
create trigger family_members_audit after insert or update or delete on public.family_group_members for each row execute function public.audit_row_change();
create trigger family_invites_audit after insert or update or delete on public.family_invitations for each row execute function public.audit_row_change();

create function public.create_family_group(p_display_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare patient uuid; group_id uuid;
begin
  patient:=public.require_family_patient();
  if (select count(*) from public.family_group_members where patient_id=patient and status='active') >= 20 then
    raise exception 'Family group limit reached' using errcode='22023'; end if;
  insert into public.family_groups(display_name,created_by) values(btrim(p_display_name),auth.uid()) returning id into group_id;
  insert into public.family_group_members(family_group_id,patient_id,relationship,role,added_by)
    values(group_id,patient,'self','owner',auth.uid());
  return group_id;
end $$;

create function public.create_family_join_code() returns text
language plpgsql security definer set search_path='' as $$
declare code text;
begin
  perform public.require_family_patient();
  -- Invalidate old unused codes; never expose recipient account identifiers.
  update public.family_join_codes set consumed_at=statement_timestamp() where created_by=auth.uid() and consumed_at is null;
  code:=gen_random_uuid()::text;
  insert into public.family_join_codes(created_by,code_hash) values(auth.uid(),encode(sha256(convert_to(code,'UTF8')),'hex'));
  return code;
end $$;

create function public.invite_family_member(p_group_id uuid,p_join_code text,p_relationship text) returns uuid
language plpgsql security definer set search_path='' as $$
declare target uuid; code_id uuid; invitation uuid;
begin
  perform public.require_family_patient();
  perform 1 from public.family_groups where id=p_group_id and created_by=auth.uid() for update;
  if not found then raise exception 'Family operation unavailable' using errcode='42501'; end if;
  select id,created_by into code_id,target from public.family_join_codes
    where code_hash=encode(sha256(convert_to(lower(btrim(p_join_code)),'UTF8')),'hex') and consumed_at is null and expires_at>statement_timestamp() for update;
  if target is null or target=auth.uid() then raise exception 'Invitation code unavailable' using errcode='42501'; end if;
  if (select count(*) from public.family_invitations where family_group_id=p_group_id and status='pending' and expires_at>statement_timestamp()) >= 50 then
    raise exception 'Invitation limit reached' using errcode='22023'; end if;
  update public.family_join_codes set consumed_at=statement_timestamp() where id=code_id;
  insert into public.family_invitations(family_group_id,invited_profile_id,invited_by,relationship)
    values(p_group_id,target,auth.uid(),p_relationship) returning id into invitation;
  return invitation;
end $$;

create function public.respond_family_invitation(p_invitation_id uuid,p_accept boolean) returns void
language plpgsql security definer set search_path='' as $$
declare patient uuid; invitation public.family_invitations;
begin
  patient:=public.require_family_patient();
  -- The group lock serializes accept/remove/grant against membership changes.
  perform 1 from public.family_groups where id=(select family_group_id from public.family_invitations where id=p_invitation_id and invited_profile_id=auth.uid()) for update;
  select * into invitation from public.family_invitations where id=p_invitation_id and invited_profile_id=auth.uid()
    and status='pending' and expires_at>statement_timestamp() for update;
  if not found or p_accept is null then raise exception 'Invitation unavailable' using errcode='42501'; end if;
  if p_accept then
    if (select count(*) from public.family_group_members where patient_id=patient and status='active') >= 20 then
      raise exception 'Family group limit reached' using errcode='22023'; end if;
    if (select count(*) from public.family_group_members where family_group_id=invitation.family_group_id and status='active') >= 50 then
      raise exception 'Member limit reached' using errcode='22023'; end if;
    insert into public.family_group_members(family_group_id,patient_id,relationship,role,added_by)
      values(invitation.family_group_id,patient,invitation.relationship,'member',invitation.invited_by)
      on conflict(family_group_id,patient_id) do update set status='active',removed_at=null,joined_at=statement_timestamp(),relationship=excluded.relationship;
  end if;
  update public.family_invitations set status=case when p_accept then 'accepted' else 'declined' end,responded_at=statement_timestamp() where id=invitation.id;
end $$;

create function public.cancel_family_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform public.require_family_patient();
  update public.family_invitations set status='cancelled',responded_at=statement_timestamp()
    where id=p_invitation_id and invited_by=auth.uid() and status='pending';
  if not found then raise exception 'Invitation unavailable' using errcode='42501'; end if;
end $$;

create function public.grant_family_authorization(p_viewer_member_id uuid,p_permissions jsonb,p_expires_at timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare patient uuid; viewer public.family_group_members; viewer_profile uuid; group_id uuid; consent uuid; authorization uuid;
begin
  patient:=public.require_family_patient();
  select family_group_id into group_id from public.family_group_members where id=p_viewer_member_id;
  perform 1 from public.family_groups where id=group_id for update;
  if not public.is_family_group_member(group_id) then raise exception 'Family operation unavailable' using errcode='42501'; end if;
  select * into viewer from public.family_group_members where id=p_viewer_member_id and status='active' and patient_id<>patient;
  if not found then raise exception 'Family operation unavailable' using errcode='42501'; end if;
  select p.profile_id into viewer_profile from public.patients p join public.profiles pr on pr.id=p.profile_id
    where p.id=viewer.patient_id and p.status='active' and pr.status='active';
  if viewer_profile is null then raise exception 'Family operation unavailable' using errcode='42501'; end if;
  if p_expires_at is null or not isfinite(p_expires_at) or p_expires_at<=statement_timestamp() or p_expires_at>statement_timestamp()+interval '1 year'
    or p_permissions is null or jsonb_typeof(p_permissions)<>'object'
    or p_permissions-ARRAY['records','appointments','medications','payments','alerts'] <> '{}'::jsonb
    or exists(select 1 from jsonb_each(p_permissions) where jsonb_typeof(value)<>'boolean')
    or not (coalesce((p_permissions->>'records')::boolean,false) or coalesce((p_permissions->>'appointments')::boolean,false)
      or coalesce((p_permissions->>'medications')::boolean,false) or coalesce((p_permissions->>'payments')::boolean,false) or coalesce((p_permissions->>'alerts')::boolean,false)) then
    raise exception 'Select explicit permissions and a future expiry within one year' using errcode='22023'; end if;
  -- One consent per grant, using existing family_access concept, never membership.
  update public.consents set status='withdrawn',withdrawn_at=statement_timestamp() where id in
    (select consent_id from public.family_authorizations where patient_id=patient and family_profile_id=viewer_profile) and status='granted';
  insert into public.consents(patient_id,granted_by_profile_id,consent_type,version,status)
    values(patient,auth.uid(),'family_access','family-foundation-v1','granted') returning id into consent;
  insert into public.family_authorizations(patient_id,family_profile_id,relationship,status,authorized_at,expires_at,
    can_view_records,can_manage_appointments,can_manage_medications,can_make_payments,can_receive_alerts,source_family_group_id,consent_id)
    values(patient,viewer_profile,viewer.relationship,'active',statement_timestamp(),p_expires_at,
      coalesce((p_permissions->>'records')::boolean,false),coalesce((p_permissions->>'appointments')::boolean,false),
      coalesce((p_permissions->>'medications')::boolean,false),coalesce((p_permissions->>'payments')::boolean,false),coalesce((p_permissions->>'alerts')::boolean,false),group_id,consent)
    on conflict(patient_id,family_profile_id) do update set relationship=excluded.relationship,status='active',authorized_at=excluded.authorized_at,
      expires_at=excluded.expires_at,revoked_at=null,revoked_by=null,can_view_records=excluded.can_view_records,
      can_manage_appointments=excluded.can_manage_appointments,can_manage_medications=excluded.can_manage_medications,
      can_make_payments=excluded.can_make_payments,can_receive_alerts=excluded.can_receive_alerts,source_family_group_id=group_id,consent_id=consent
    returning id into authorization;
  return authorization;
end $$;

create function public.revoke_family_authorization(p_authorization_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare patient uuid; consent uuid;
begin
  patient:=public.require_family_patient();
  update public.family_authorizations set status='revoked',revoked_at=statement_timestamp(),revoked_by=auth.uid()
    where id=p_authorization_id and patient_id=patient returning consent_id into consent;
  if not found then raise exception 'Authorization unavailable' using errcode='42501'; end if;
  update public.consents set status='withdrawn',withdrawn_at=statement_timestamp() where id=consent and status='granted';
end $$;

create function public.remove_family_member(p_member_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare patient uuid; member public.family_group_members; target_profile uuid;
begin
  patient:=public.require_family_patient();
  perform 1 from public.family_groups where id=(select family_group_id from public.family_group_members where id=p_member_id) for update;
  select * into member from public.family_group_members where id=p_member_id and status='active' and role<>'owner';
  if not found or not (member.patient_id=patient or exists(select 1 from public.family_groups where id=member.family_group_id and created_by=auth.uid())) then
    raise exception 'Family operation unavailable' using errcode='42501'; end if;
  select profile_id into target_profile from public.patients where id=member.patient_id;
  update public.family_group_members set status='removed',removed_at=statement_timestamp() where id=member.id;
  update public.consents set status='withdrawn',withdrawn_at=statement_timestamp() where status='granted' and id in
    (select consent_id from public.family_authorizations where source_family_group_id=member.family_group_id and (patient_id=member.patient_id or family_profile_id=target_profile));
  update public.family_authorizations set status='revoked',revoked_at=statement_timestamp(),revoked_by=auth.uid()
    where source_family_group_id=member.family_group_id and status<>'revoked' and (patient_id=member.patient_id or family_profile_id=target_profile);
  update public.family_invitations set status='cancelled',responded_at=statement_timestamp()
    where family_group_id=member.family_group_id and invited_profile_id=target_profile and status='pending';
end $$;

-- Bounded sanitized views: names are shared only after membership acceptance.
create function public.get_my_family_groups() returns table(id uuid,display_name text,is_owner boolean)
language plpgsql stable security definer set search_path='' as $$
begin
  perform public.require_family_patient();
  return query select g.id,g.display_name,g.created_by=auth.uid() from public.family_groups g
    where public.is_family_group_member(g.id) order by g.created_at,g.id limit 20;
end $$;
create function public.get_my_family_invitations() returns table(id uuid,family_group_id uuid,display_name text,relationship text,status text,expires_at timestamptz,is_incoming boolean)
language plpgsql stable security definer set search_path='' as $$
begin
  perform public.require_family_patient();
  return query select i.id,i.family_group_id,g.display_name,i.relationship,
    case when i.status='pending' and i.expires_at<=statement_timestamp() then 'expired' else i.status end,i.expires_at,i.invited_profile_id=auth.uid()
    from public.family_invitations i join public.family_groups g on g.id=i.family_group_id
    where i.invited_profile_id=auth.uid() or i.invited_by=auth.uid() order by i.created_at desc,i.id limit 100;
end $$;
create function public.get_family_members(p_group_id uuid) returns table(id uuid,display_name text,relationship text,role text,is_self boolean,authorization jsonb)
language plpgsql stable security definer set search_path='' as $$
declare patient uuid;
begin
  patient:=public.require_family_patient();
  if not public.is_family_group_member(p_group_id) then raise exception 'Family operation unavailable' using errcode='42501'; end if;
  return query select m.id,p.full_name,m.relationship,m.role,p.id=patient,
    (select jsonb_build_object('id',fa.id,'status',case when fa.status='active' and fa.expires_at<=statement_timestamp() then 'expired'
      when fa.status='active' and fa.consent_id is not null and not exists(select 1 from public.consents c where c.id=fa.consent_id and c.status='granted') then 'inactive' else fa.status::text end,
      'expires_at',fa.expires_at,'records',fa.can_view_records,'appointments',fa.can_manage_appointments,'medications',fa.can_manage_medications,'payments',fa.can_make_payments,'alerts',fa.can_receive_alerts)
      from public.family_authorizations fa where fa.patient_id=patient and fa.family_profile_id=p.profile_id)
    from public.family_group_members m join public.patients p on p.id=m.patient_id
    where m.family_group_id=p_group_id and m.status='active' order by (m.role='owner') desc,m.joined_at,m.id limit 50;
end $$;

-- Keep all non-family branches byte-for-byte from the final Repair 3 definition.
create or replace function public.can_access_patient(target_patient_id uuid, permission_name text default 'view')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.clinical_identity_is_current() and (
    exists (
      select 1 from public.patients patient
      where patient.id = target_patient_id and patient.auth_user_id = auth.uid()
    )
    or public.is_main_admin()
    or exists (
      select 1 from public.family_authorizations fa
      where fa.patient_id = target_patient_id
        and fa.family_profile_id = auth.uid()
        and fa.status = 'active'
        and fa.revoked_at is null
        and (fa.expires_at is null or fa.expires_at > statement_timestamp())
        and (fa.consent_id is null or exists (select 1 from public.consents c where c.id=fa.consent_id and c.patient_id=fa.patient_id and c.status='granted'))
        and case permission_name
          when 'appointments' then fa.can_manage_appointments
          when 'medications' then fa.can_manage_medications
          when 'payments' then fa.can_make_payments
          when 'alerts' then fa.can_receive_alerts
          else fa.can_view_records
        end
    )
    or exists (
      select 1 from public.providers provider
      where public.current_profile_role() in ('doctor','nurse','caregiver') and provider.profile_id = auth.uid() and provider.verification_status = 'verified'
        and (
          exists (select 1 from public.appointments appointment where appointment.patient_id = target_patient_id and appointment.provider_id = provider.id)
          or exists (
            select 1 from public.care_assignments assignment
            join public.care_requests request on request.id = assignment.care_request_id
            where request.patient_id = target_patient_id
              and assignment.provider_id = provider.id
              and assignment.status in ('assigned', 'accepted')
          )
        )
    )
    or (permission_name in ('view', 'appointments', 'alerts') and exists (
      select 1 from public.care_coordinators coordinator
      where public.current_profile_role() = 'coordinator' and coordinator.profile_id = auth.uid()
        and (
          exists (select 1 from public.patients patient where patient.id = target_patient_id and patient.primary_coordinator_id = coordinator.id)
          or exists (select 1 from public.care_requests request where request.patient_id = target_patient_id and request.coordinator_id = coordinator.id)
        )
    ))
    or (permission_name in ('appointments', 'alerts') and exists (
      select 1
      from public.clinic_staff admin_staff
      join public.clinic_staff provider_staff
        on provider_staff.clinic_id = admin_staff.clinic_id and provider_staff.status = 'active'
      join public.appointments appointment on appointment.provider_id = provider_staff.provider_id
      where public.current_profile_role() = 'clinic_admin' and admin_staff.profile_id = auth.uid()
        and admin_staff.clinic_role = 'sub_admin'
        and admin_staff.status = 'active'
        and appointment.patient_id = target_patient_id
    ))
  )
$$;


revoke all on function public.can_access_patient(uuid,text) from public, anon;
grant execute on function public.can_access_patient(uuid,text) to authenticated;

-- Explicit signatures: no unsafe default PUBLIC execute on mutation RPCs.
revoke all on function public.create_family_group(text),public.create_family_join_code(),public.invite_family_member(uuid,text,text),
  public.respond_family_invitation(uuid,boolean),public.cancel_family_invitation(uuid),public.grant_family_authorization(uuid,jsonb,timestamptz),
  public.revoke_family_authorization(uuid),public.remove_family_member(uuid),public.get_my_family_groups(),public.get_my_family_invitations(),public.get_family_members(uuid) from public, anon;
grant execute on function public.create_family_group(text),public.create_family_join_code(),public.invite_family_member(uuid,text,text),
  public.respond_family_invitation(uuid,boolean),public.cancel_family_invitation(uuid),public.grant_family_authorization(uuid,jsonb,timestamptz),
  public.revoke_family_authorization(uuid),public.remove_family_member(uuid),public.get_my_family_groups(),public.get_my_family_invitations(),public.get_family_members(uuid) to authenticated;
commit;

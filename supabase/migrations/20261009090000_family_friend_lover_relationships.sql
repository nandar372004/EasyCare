begin;

-- Extend only the relationship vocabulary; preserve existing values and RLS.
alter table public.family_invitations
  drop constraint family_invitations_relationship_check,
  add constraint family_invitations_relationship_check check (
    relationship in ('spouse','lover','friend','mother','father','parent','child','sibling','guardian','other')
  );

alter table public.family_group_members
  drop constraint family_group_members_relationship_check,
  add constraint family_group_members_relationship_check check (
    relationship in ('self','spouse','lover','friend','mother','father','parent','child','sibling','guardian','dependent','other')
  );

commit;

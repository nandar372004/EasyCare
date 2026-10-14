# EasyCare Phase G — Login and Workspace Flow

## Current sign-in paths

- Patient accounts sign in with phone and password and open the patient dashboard.
- Verified providers can use phone sign-in or the provider sign-in page. Their destination is determined by the server-resolved provider identity.
- Main administrators use the admin email sign-in path and open the provider application review queue.
- If one account has more than one authorized identity, EasyCare asks the user to choose a workspace. The choice is remembered for session restoration and can be changed from the workspace switcher.

## Identity and route boundaries

Patient, provider, and administrator identities are loaded from the existing authorization sources. Workspace selection only chooses a destination for an identity already returned by those sources; it does not grant or change a role. Route guards require the matching resolved identity before rendering each workspace. Provider patient access continues to use the existing relationship-scoped server authorization.

## Session and account switching

Session restoration has a finite timeout. If session or identity resolution fails, the client clears its authenticated state and returns to sign-in with a recoverable message. Signing out immediately clears the visible identity and workspace preference before completing local Supabase sign-out, preventing stale workspace content from remaining on screen.

## Presentation

The shared workspace switcher only lists identities currently available to the signed-in user. Provider displays use the common provider-type labels, including the nurse subtypes. Patient, provider, and administrator workspaces expose sign-out, and their loading, empty, and retryable error states remain within the current authorization model.

## Verification scope

This is a local UI and session-routing update. It does not change database schema, deployed Staging state, provider verification, provider-patient relationships, Family authorization, or Care Plan authorization.

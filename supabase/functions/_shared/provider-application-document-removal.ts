export type CredentialRemovalDependencies = {
  authenticate: (authorization: string) => Promise<{ id: string } | null>
  getProfile: (userId: string) => Promise<{ role: string; status: string } | null>
  getApplication: (applicationId: string, userId: string) => Promise<{ id: string; applicant_profile_id: string; status: string } | null>
  getDocument: (documentId: string, applicationId: string, userId: string) => Promise<Record<string, unknown> | null>
  isPrivateBucket: () => Promise<boolean>
  download: (path: string) => Promise<Uint8Array | null>
  removeStorage: (path: string) => Promise<void>
  storageExists: (path: string) => Promise<boolean>
  deleteMetadata: (userId: string, applicationId: string, documentId: string) => Promise<void>
  documentExists: (documentId: string, applicationId: string, userId: string) => Promise<boolean>
  restoreStorage: (path: string, bytes: Uint8Array, mimeType: string) => Promise<void>
  restoreMetadata: (document: Record<string, unknown>) => Promise<void>
}

export type CredentialRemovalResult = { status: number; body: { ok: boolean; error?: string } }

const fail = (status: number, error: string): CredentialRemovalResult => ({ status, body: { ok: false, error } })

export async function removeDraftProviderCredential(
  input: { authorization: string; applicationId: string; documentId: string },
  dependencies: CredentialRemovalDependencies,
): Promise<CredentialRemovalResult> {
  const user = await dependencies.authenticate(input.authorization)
  if (!user) return fail(401, 'UNAUTHORIZED')

  const profile = await dependencies.getProfile(user.id)
  if (!profile || profile.status !== 'active' || !['patient', 'family'].includes(profile.role)) return fail(403, 'FORBIDDEN')

  const application = await dependencies.getApplication(input.applicationId, user.id)
  if (!application || application.applicant_profile_id !== user.id) return fail(404, 'DOCUMENT_UNAVAILABLE')
  if (application.status !== 'draft') return fail(409, 'DRAFT_REQUIRED')

  const document = await dependencies.getDocument(input.documentId, application.id, user.id)
  if (!document || document.application_id !== application.id || document.applicant_profile_id !== user.id) return fail(404, 'DOCUMENT_UNAVAILABLE')

  const path = document.storage_path
  const mimeType = document.mime_type
  if (typeof path !== 'string' || typeof mimeType !== 'string' || !path.startsWith(`${user.id}/${application.id}/`)) {
    return fail(409, 'DOCUMENT_UNAVAILABLE')
  }
  if (!await dependencies.isPrivateBucket()) return fail(503, 'PRIVATE_STORAGE_UNAVAILABLE')

  let backup: Uint8Array | null
  try {
    backup = await dependencies.download(path)
  } catch {
    return fail(503, 'STORAGE_UNAVAILABLE')
  }

  try {
    if (backup) await dependencies.removeStorage(path)
    if (await dependencies.storageExists(path)) return fail(503, 'STORAGE_DELETE_FAILED')
  } catch {
    try {
      if (await dependencies.storageExists(path)) return fail(503, 'STORAGE_DELETE_FAILED')
    } catch {
      return fail(503, 'STORAGE_STATE_UNKNOWN')
    }
  }

  try {
    await dependencies.deleteMetadata(user.id, application.id, input.documentId)
  } catch {
    try {
      const [rowExists, objectExists] = await Promise.all([
        dependencies.documentExists(input.documentId, application.id, user.id),
        dependencies.storageExists(path),
      ])
      if (!rowExists && !objectExists) return { status: 200, body: { ok: true } }
      if (rowExists && !objectExists && !backup) {
        await dependencies.deleteMetadata(user.id, application.id, input.documentId)
        if (!await dependencies.documentExists(input.documentId, application.id, user.id)
          && !await dependencies.storageExists(path)) return { status: 200, body: { ok: true } }
      }
      if (!objectExists && backup) await dependencies.restoreStorage(path, backup, mimeType)
      if (!rowExists && backup) await dependencies.restoreMetadata(document)
      return fail(503, 'REMOVAL_FAILED_RESTORED')
    } catch {
      return fail(503, 'REMOVAL_COMPENSATION_FAILED')
    }
  }

  try {
    const [rowExists, objectExists] = await Promise.all([
      dependencies.documentExists(input.documentId, application.id, user.id),
      dependencies.storageExists(path),
    ])
    if (!rowExists && !objectExists) return { status: 200, body: { ok: true } }

    if (!objectExists && backup) await dependencies.restoreStorage(path, backup, mimeType)
    if (!rowExists) await dependencies.restoreMetadata(document)
    return fail(503, 'REMOVAL_VERIFICATION_FAILED_RESTORED')
  } catch {
    try {
      if (backup) {
        await dependencies.restoreStorage(path, backup, mimeType)
        await dependencies.restoreMetadata(document)
        return fail(503, 'REMOVAL_VERIFICATION_FAILED_RESTORED')
      }
    } catch {
      return fail(503, 'REMOVAL_COMPENSATION_FAILED')
    }
    return fail(503, 'REMOVAL_VERIFICATION_FAILED')
  }
}

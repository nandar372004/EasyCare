async function objectExists(path, dependencies) {
  try { return await dependencies.storageExists(path) }
  catch { throw new Error('STORAGE_STATE_UNKNOWN') }
}

export async function uploadMedicalDocument({ path, bytes, mimeType, metadata }, dependencies) {
  try { await dependencies.uploadStorage(path, bytes, mimeType) }
  catch { return { ok: false, error: 'STORAGE_UPLOAD_FAILED' } }
  try {
    const id = await dependencies.recordMetadata(metadata)
    return { ok: true, id }
  } catch {
    try {
      await dependencies.removeStorage(path)
      if (await objectExists(path, dependencies)) return { ok: false, error: 'STORAGE_CLEANUP_FAILED' }
      return { ok: false, error: 'METADATA_CREATE_FAILED' }
    } catch {
      return { ok: false, error: 'STORAGE_CLEANUP_FAILED' }
    }
  }
}

export async function removeMedicalDocument(document, dependencies) {
  let backup
  try { backup = await dependencies.download(document.storage_path) }
  catch { return { ok: false, error: 'STORAGE_READ_FAILED' } }
  if (!backup) return { ok: false, error: 'STORAGE_READ_FAILED' }

  try {
    await dependencies.removeStorage(document.storage_path)
    if (await objectExists(document.storage_path, dependencies)) return { ok: false, error: 'STORAGE_DELETE_FAILED' }
  } catch {
    try {
      if (await objectExists(document.storage_path, dependencies)) return { ok: false, error: 'STORAGE_DELETE_FAILED' }
    } catch { return { ok: false, error: 'STORAGE_STATE_UNKNOWN' } }
  }

  try { await dependencies.setRemoved(document) }
  catch (error) {
    const failureCode = error?.code === '23503' ? 'DATABASE_DEPENDENCY_BLOCKED' : 'METADATA_REMOVE_FAILED'
    try {
      const [status, fileExists] = await Promise.all([
        dependencies.status(document.id), objectExists(document.storage_path, dependencies),
      ])
      if (status === 'removed' && !fileExists) return { ok: true }
      if (!fileExists) await dependencies.restoreStorage(document.storage_path, backup, document.mime_type)
      return { ok: false, error: failureCode }
    } catch { return { ok: false, error: 'REMOVAL_COMPENSATION_FAILED' } }
  }

  try {
    const [status, fileExists] = await Promise.all([
      dependencies.status(document.id), objectExists(document.storage_path, dependencies),
    ])
    if (status === 'removed' && !fileExists) return { ok: true }
    if (!fileExists) await dependencies.restoreStorage(document.storage_path, backup, document.mime_type)
    if (status === 'removed') await dependencies.restoreActive(document.id)
    return { ok: false, error: 'REMOVAL_VERIFICATION_FAILED' }
  } catch { return { ok: false, error: 'REMOVAL_COMPENSATION_FAILED' } }
}

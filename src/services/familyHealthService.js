import { withViewerRelationships } from './familyRelationship.js'
import { createFamilyHealthRepository } from './repositories/familyHealthRepository.js'

const SECTION_SCOPES = Object.freeze({
  appointments: 'appointments',
  medications: 'medications',
  alerts: 'alerts',
  vitals: 'records',
  trends: 'records',
  records: 'records',
  medicalDocuments: 'records',
  labs: 'records',
  documentIntelligence: 'records',
  documentActivity: 'records',
  carePlan: 'care_plans',
  patientCarePlan: 'care_plans',
  followUps: 'records',
})

const familyHealthServiceFor = (repository = null, now = () => Date.now()) => {
  const source = () => repository || (repository = createFamilyHealthRepository())
  const directory = () => source().getGroups()
  const members = async groupId => withViewerRelationships(await source().getMembers(groupId), { groupId })

  function grantState(authorization) {
    if (!authorization) return 'not_authorized'
    if (authorization.status === 'expired' || (authorization.expires_at && Date.parse(authorization.expires_at) <= now())) return 'expired'
    if (['revoked', 'inactive', 'removed'].includes(authorization.status)) return 'revoked'
    if (authorization.status !== 'active') return 'not_authorized'
    return 'active'
  }

  function permissionStatus(authorization, scope) {
    const state = grantState(authorization)
    if (state !== 'active') return state
    return authorization[scope] === true ? 'loading' : 'not_authorized'
  }

  function blockedStatus(authorization, scope, section) {
    const status = permissionStatus(authorization, scope)
    if (section === 'labs') return { status: 'unsupported', data: null }
    return status === 'loading' ? null : { status, data: null }
  }

  async function loadHealth({ groupId, memberId, selfPatient, commandCenter = false, sharedOwnSections, initialMembers }, batch = null) {
    const dataSource = source()
    const isSelf = Boolean(selfPatient?.id)
    let member
    let patientId
    let authorization = null

    if (isSelf) {
      member = { member_id: 'self', patient_id: selfPatient.id, display_name: selfPatient.full_name || 'You', relationship: 'self', role: 'self', is_self: true }
      patientId = selfPatient.id
    } else {
      if (!groupId || !memberId) return { member: null, membershipRemoved: true, sections: {} }
      const availableMembers = batch?.initialMembers || initialMembers || await members(groupId)
      member = availableMembers.find(row => row.member_id === memberId && !row.is_self)
      if (!member) return { member: null, membershipRemoved: true, sections: {} }
      patientId = member.patient_id
      authorization = member.authorization
    }

    const grantActive = isSelf || grantState(authorization) === 'active'
    const scopes = isSelf
      ? { records: true, appointments: true, medications: true, alerts: true }
      : { records: grantActive && authorization?.records === true, appointments: grantActive && authorization?.appointments === true, medications: grantActive && authorization?.medications === true, alerts: grantActive && authorization?.alerts === true, care_plans: grantActive && authorization?.care_plans === true }

    let tasks = {
      appointments: scopes.appointments && (!scopes.care_plans || isSelf) ? () => commandCenter ? dataSource.getCommandAppointments(patientId) : dataSource.getUpcomingAppointments ? dataSource.getUpcomingAppointments(patientId) : dataSource.getNextAppointment(patientId).then(row => row ? [row] : []) : null,
      medications: scopes.medications && (!scopes.care_plans || isSelf) ? () => dataSource.getMedications(patientId) : null,
      alerts: scopes.alerts ? () => dataSource.getActiveAlerts(patientId) : null,
      vitals: scopes.records ? () => dataSource.getLatestVitals(patientId) : null,
      trends: scopes.records ? () => dataSource.getVitalHistory(patientId, 'heart_rate', '30d') : null,
      records: scopes.records ? () => isSelf
        ? dataSource.getRecentHealthRecords(patientId)
        : dataSource.getFamilyReportedHealthRecords(groupId, memberId) : null,
      medicalDocuments: scopes.records && !isSelf ? () => dataSource.getFamilyMedicalDocuments(patientId) : null,
      labs: isSelf && scopes.records ? () => dataSource.getRecentLabResults(patientId) : null,
      documentIntelligence: scopes.records ? () => dataSource.getDocumentFactIntelligence(patientId) : null,
      carePlan: isSelf ? async () => ({ self: true }) : scopes.care_plans ? () => dataSource.getFamilyCarePlans(groupId, memberId) : null,
      patientCarePlan: !isSelf && scopes.care_plans ? () => dataSource.getFamilyPatientCarePlan(groupId, memberId) : null,
    }
    if (commandCenter) {
      // The overview never requests vital history, labs or clinical encounter text.
      tasks = Object.fromEntries(['appointments', 'medications', 'alerts', 'documentIntelligence', 'carePlan', 'patientCarePlan'].map(name => [name, tasks[name]]))
      tasks.documentActivity = scopes.records ? () => dataSource.getCommandDocuments(patientId) : null
      tasks.followUps = scopes.records ? () => dataSource.getCommandFollowUps(patientId) : null
    } else {
      // The member detail view requests only the explicitly shared modules.
      tasks = {
        appointments: scopes.appointments ? tasks.appointments : null,
        medications: scopes.medications ? tasks.medications : null,
        records: scopes.records ? tasks.records : null,
        medicalDocuments: !isSelf && scopes.records ? tasks.medicalDocuments : null,
        carePlan: isSelf ? tasks.carePlan : scopes.care_plans ? tasks.carePlan : null,
        patientCarePlan: isSelf ? null : scopes.care_plans ? tasks.patientCarePlan : null,
      }
    }
    // Only the already-resolved signed-in patient's identical read sources
    // may be shared. Family member reads always use their scope/recheck path.
    if (isSelf && commandCenter && sharedOwnSections) {
      for (const name of ['appointments', 'medications', 'alerts']) {
        if (typeof sharedOwnSections[name] === 'function') tasks[name] = sharedOwnSections[name]
      }
    }
    const names = Object.keys(tasks)
    const results = await Promise.all(names.map(async name => {
      if (!tasks[name]) return [name, blockedStatus(authorization, SECTION_SCOPES[name], name)]
      try { return [name, { status: 'ready', data: await tasks[name]() }] }
      catch (error) { return [name, { status: name === 'followUps' && error.code === '42501' ? 'unsupported' : 'error', data: null }] }
    }))
    let sections = Object.fromEntries(results)

    // The scoped patient-owned projection also supplies these Family Health
    // panels when care_plans is active, avoiding a second read of the same rows.
    if (!isSelf && scopes.care_plans) {
      const patientPlan = sections.patientCarePlan
      if (scopes.medications) sections.medications = patientPlan?.status === 'ready'
        ? { status: 'ready', data: patientPlan.data?.medications || [] }
        : { status: patientPlan?.status || 'error', data: null }
      if (scopes.appointments) sections.appointments = patientPlan?.status === 'ready'
        ? { status: 'ready', data: patientPlan.data?.appointments || [] }
        : { status: patientPlan?.status || 'error', data: null }
    }

    if (!isSelf && !batch?.deferRecheck) {
      let fresh
      try { fresh = (await members(groupId)).find(row => row.member_id === memberId && !row.is_self) }
      catch {
        sections = Object.fromEntries(names.map(name => [name, tasks[name] ? { status: 'error', data: null } : sections[name]]))
        return { member, membershipRemoved: false, permissions: scopes, authorizationStatus: grantState(authorization), expiresAt: authorization?.expires_at, sections }
      }
      if (!fresh || fresh.patient_id !== patientId) return { member: null, membershipRemoved: true, sections: {} }

      const updatedAuthorization = fresh.authorization
      for (const name of names) {
        const current = permissionStatus(updatedAuthorization, SECTION_SCOPES[name])
        if (current !== 'loading') {
          sections[name] = { status: current, data: null }
        }
      }
      authorization = updatedAuthorization
      member = fresh
      scopes.records = authorization?.records === true && grantState(authorization) === 'active'
      scopes.appointments = authorization?.appointments === true && grantState(authorization) === 'active'
      scopes.medications = authorization?.medications === true && grantState(authorization) === 'active'
      scopes.alerts = authorization?.alerts === true && grantState(authorization) === 'active'
      scopes.care_plans = authorization?.care_plans === true && grantState(authorization) === 'active'
    }

    return { member, membershipRemoved: false, permissions: scopes, authorizationStatus: isSelf ? 'self' : grantState(authorization), expiresAt: authorization?.expires_at, sections }
  }

  return {
    getGroups: directory, getMembers: members, loadHealth: input => loadHealth(input),
    async loadCommandCenterGroup(groupId) {
      const initialMembers = await members(groupId)
      const readouts = await Promise.all(initialMembers.filter(member => !member.is_self).map(member => loadHealth(
        { groupId, memberId: member.member_id, commandCenter: true }, { initialMembers, deferRecheck: true },
      )))
      // Recheck AFTER every read settles. Shared directory reads never become a
      // cross-request cache, and grant removal/expiry masks already-loaded data.
      const freshMembers = await members(groupId)
      return readouts.flatMap(readout => {
        const fresh = freshMembers.find(member => member.member_id === readout.member?.member_id && member.patient_id === readout.member?.patient_id && !member.is_self)
        if (!fresh) return []
        const sections = Object.fromEntries(Object.entries(readout.sections).map(([name, section]) => {
          const permission = permissionStatus(fresh.authorization, SECTION_SCOPES[name])
          return [name, permission === 'loading' ? section : { status: permission, data: null }]
        }))
        const permissions = Object.fromEntries(['records', 'appointments', 'medications', 'alerts', 'care_plans'].map(scope => [scope, permissionStatus(fresh.authorization, scope) === 'loading']))
        return [{ ...readout, member: { ...fresh, groupId }, permissions, sections, authorizationStatus: grantState(fresh.authorization), expiresAt: fresh.authorization?.expires_at }]
      })
    },
    createDocumentSignedUrl(patientId, documentId) {
      return source().createDocumentSignedUrl(patientId, documentId)
    },
  }
}

export const createFamilyHealthService = familyHealthServiceFor
export const familyHealthService = familyHealthServiceFor()


import { createFamilyService } from './familyService.js'
import { createFamilyHealthService } from './familyHealthService.js'
import { describe, expect, it } from 'vitest'
import { familyRelationshipLabel, inverseFamilyRelationship, normalizeFamilyRelationship, resolveFamilyRelationship, resolveInvitationRelationship, withViewerRelationships } from './familyRelationship.js'
const rows = [
  { id:'n', patient_id:'n', role:'owner', relationship:'self' },
  { id:'f', patient_id:'f', role:'member', relationship:'father' },
  { id:'m', patient_id:'m', role:'member', relationship:'mother' },
]
const view = id => withViewerRelationships(rows.map(row => ({...row,is_self:row.id===id})), {groupId:'family'})
describe('viewer-relative family relationships',()=>{
  it('shows the owner their recorded parent relationships',()=>{
    expect(view('n').map(r=>r.relationshipLabel)).toEqual(['Self','Father','Mother'])
  })
  it('shows the father himself, the child, and the supported mother-pair Wife',()=>{
    expect(view('f').map(r=>r.relationshipLabel)).toEqual(['Child','Self','Wife'])
  })
  it('shows the mother herself and the neutral inverse child',()=>{
    expect(view('m').map(r=>r.relationshipLabel)).toEqual(['Child','Husband','Self'])
  })
  it('always labels the viewer Self despite their stored relationship or membership role',()=>{
    expect(view('f')[1].relationshipLabel).toBe('Self')
  })
  it('uses only the viewer row, not group creator metadata or row ordering',()=>{
    const family=view('f')
    expect(withViewerRelationships(family.toReversed().map(r=>({...r,created_by:'other'}))).find(r=>r.id==='n').relationshipLabel).toBe('Child')
  })
  it('does not derive relationships when the viewer or owner is missing',()=>{
    expect(withViewerRelationships(rows).every(r=>r.relationshipLabel==='Family member')).toBe(true)
    expect(withViewerRelationships([{is_self:true,role:'member',relationship:'father'},{role:'member',relationship:'mother'}]).map(r=>r.relationshipLabel)).toEqual(['Self','Family member'])
  })
  it('has neutral inverse fallbacks and preserves stored rows and authorizations',()=>{
    expect(['father','mother','parent'].map(inverseFamilyRelationship)).toEqual(['Child','Child','Child'])
    expect(inverseFamilyRelationship('child')).toBe('Parent')
    expect(inverseFamilyRelationship('spouse')).toBe('Spouse')
    expect(inverseFamilyRelationship('sibling')).toBe('Sibling')
    expect(inverseFamilyRelationship('guardian')).toBe('Family member')
    const original=structuredClone(rows)
    view('f')
    expect(rows).toEqual(original)
  })
})

describe('relationship service propagation',()=>{
  it.each(['n','f','m'])('uses the same labels in management and shared-health directories for viewer %s',async viewer=>{
    const members=rows.map(row=>({...row,member_id:row.id,is_self:row.id===viewer}))
    const original=structuredClone(members)
    const management=await createFamilyService({getFamilyMembers:async()=>members}).getFamilyMembers('only-authorized-group')
    const health=await createFamilyHealthService({getMembers:async()=>members}).getMembers('only-authorized-group')
    expect(management.map(row=>row.relationshipLabel)).toEqual(health.map(row=>row.relationshipLabel))
    expect(health.find(row=>row.id===viewer).relationshipLabel).toBe('Self')
    expect(members).toEqual(original)
  })
})

describe('Friend and Lover support',()=>{
  it.each(['friend','lover'])('keeps %s symmetric only for the recorded owner pair', relationship=>{
    const members=[{id:'owner',role:'owner',relationship:'self'},{id:'pair',role:'member',relationship},{id:'third',role:'member',relationship:'friend'}]
    const expected=relationship==='friend'?'Friend':'Lover'
    const ownerView=withViewerRelationships(members.map(row=>({...row,is_self:row.id==='owner'})))
    const pairView=withViewerRelationships(members.map(row=>({...row,is_self:row.id==='pair'})))
    expect(ownerView[1].relationshipLabel).toBe(expected)
    expect(pairView[0].relationshipLabel).toBe(expected)
    expect(pairView[1].relationshipLabel).toBe('Self')
    expect(pairView[2].relationshipLabel).toBe('Family member')
    expect(pairView[0].relationshipLabel).not.toBe('Spouse')
  })
  it.each(['self','spouse','lover','friend','mother','father','parent','child','sibling','guardian','dependent','other'])('normalizes %s without rewriting raw metadata',value=>{
    expect(normalizeFamilyRelationship('  '+value.toUpperCase()+'  ')).toBe(value)
    expect(familyRelationshipLabel(' '+value.toUpperCase()+' ')).toBe(familyRelationshipLabel(value))
    expect(inverseFamilyRelationship(' '+value.toUpperCase()+' ')).toBe(inverseFamilyRelationship(value))
  })
  it.each([null,undefined,'unknown','constructor','__proto__',{},42])('safely falls back for unsupported input %s',value=>{
    expect(normalizeFamilyRelationship(value)).toBeNull()
    expect(familyRelationshipLabel(value)).toBe('Family member')
    expect(inverseFamilyRelationship(value)).toBe('Family member')
  })
})

describe('canonical viewer perspective contract',()=>{
  const resolve = input => resolveFamilyRelationship({ownerPatientId:'owner',viewerPatientId:'viewer',targetPatientId:'target',...input})
  it.each(['mother','father','parent','child','sibling','spouse','lover','friend','guardian','other',null])('patient ID self overrides stored relationship %s and missing owner', relationship=>{
    expect(resolveFamilyRelationship({viewerPatientId:'same',targetPatientId:'same',targetRelationshipToOwner:relationship})).toBe('Self')
  })
  it.each([
    ['mother','Mother','Child'],['father','Father','Child'],['parent','Parent','Child'],
    ['child','Child','Parent'],['sibling','Sibling','Sibling'],['spouse','Spouse','Spouse'],
    ['lover','Lover','Lover'],['friend','Friend','Friend'],['guardian','Guardian','Family member'],
    ['other','Family member','Family member'],
  ])('resolves owner and inverse member views for %s', (relationship,ownerLabel,inverse)=>{
    expect(resolve({viewerPatientId:'owner',targetRelationshipToOwner:' '+relationship.toUpperCase()+' '})).toBe(ownerLabel)
    expect(resolve({targetPatientId:'owner',viewerRelationshipToOwner:relationship})).toBe(inverse)
  })
  it.each([['mother','father','Husband'],['father','mother','Wife']])('derives %s viewing %s only for the accepted same-owner family', (viewer,target,expected)=>{
    const input={viewerRelationshipToOwner:' '+viewer.toUpperCase()+' ',targetRelationshipToOwner:target}
    expect(resolve({...input,acceptedSameFamily:true})).toBe(expected)
    expect(resolve(input)).toBe('Family member')
  })
  it.each([
    ['mother','parent'],['father','guardian'],['parent','parent'],['friend','friend'],
    ['lover','friend'],['lover','lover'],['child','sibling'],['sibling','sibling'],['other','father'],
  ])('does not infer a non-owner relation from %s and %s', (viewer,target)=>{
    expect(resolve({viewerRelationshipToOwner:viewer,targetRelationshipToOwner:target,acceptedSameFamily:true})).toBe('Family member')
  })
  it.each([null,undefined,'unknown',{},'__proto__'])('keeps unknown relationship %s neutral', relationship=>{
    expect(resolve({viewerPatientId:'owner',targetRelationshipToOwner:relationship})).toBe('Family member')
    expect(resolve({targetPatientId:'owner',viewerRelationshipToOwner:relationship})).toBe('Family member')
  })
  it('does not claim Self for missing identities or for another member stored as self',()=>{
    expect(resolveFamilyRelationship()).toBe('Family member')
    expect(resolve({viewerPatientId:'owner',targetRelationshipToOwner:'self'})).toBe('Family member')
  })
  it.each(['removed','pending'])('does not derive a parental pair when target membership is %s',status=>{
    const members=rows.map(row=>({...row,is_self:row.id==='m',status:row.id==='f'?status:'active'}))
    expect(withViewerRelationships(members,{groupId:'family'}).find(row=>row.id==='f').relationshipLabel).toBe('Family member')
  })
  it('does not combine different families, unscoped directories or ambiguous owners',()=>{
    const members=rows.map(row=>({...row,is_self:row.id==='m',family_group_id:row.id==='f'?'other-family':'family'}))
    expect(withViewerRelationships(members,{groupId:'family'}).find(row=>row.id==='f').relationshipLabel).toBe('Family member')
    expect(withViewerRelationships(members).find(row=>row.id==='f').relationshipLabel).toBe('Family member')
    expect(withViewerRelationships([...members,{id:'other-owner',role:'owner'}],{groupId:'family'}).find(row=>row.id==='f').relationshipLabel).toBe('Family member')
  })
  it('uses the supplied authenticated patient ID for self even if a raw self flag disagrees',()=>{
    const members=rows.map(row=>({...row,is_self:row.id==='n'}))
    expect(withViewerRelationships(members,{groupId:'family',viewerPatientId:'f'}).map(row=>row.relationshipLabel)).toEqual(['Child','Self','Wife'])
  })
  it('works with scoped management membership IDs that do not expose patient UUIDs',()=>{
    const members=rows.map(({patient_id,...row})=>({...row,is_self:row.id==='f'}))
    expect(withViewerRelationships(members,{groupId:'family'}).map(row=>row.relationshipLabel)).toEqual(['Child','Self','Wife'])
  })
  it('uses the canonical owner/inverse rules for invitations without deriving non-member pairs',()=>{
    expect(resolveInvitationRelationship(' Mother ',false)).toBe('Mother')
    expect(resolveInvitationRelationship(' Mother ',true)).toBe('Child')
    for(const relationship of ['friend','lover','spouse']) {
      expect(resolveInvitationRelationship(relationship,true)).toBe(familyRelationshipLabel(relationship))
      expect(resolveInvitationRelationship(relationship,false)).toBe(familyRelationshipLabel(relationship))
    }
  })
})

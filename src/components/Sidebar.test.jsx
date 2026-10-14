import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { LocalizationProvider } from '../features/localization/LocalizationContext.jsx'
import { primaryNavigation } from '../data/navigation.js'
import { Sidebar } from './Sidebar.jsx'
import { BottomNav } from './BottomNav.jsx'

function labelsIn(groupEl) {
  return within(groupEl).getAllByRole('link').map((link) => link.textContent.trim())
}

function renderNav(path) {
  return render(
    <LocalizationProvider>
      <MemoryRouter initialEntries={[path]}>
        <Sidebar />
        <BottomNav />
      </MemoryRouter>
    </LocalizationProvider>,
  )
}

describe('sidebar family navigation', () => {
  it('places My Care Plan, My Family, and Care Circle under Dashboard in the requested order', () => {
    const myFamily = primaryNavigation.filter((item) => item.label === 'My Family')
    const careCircle = primaryNavigation.filter((item) => item.label === 'Care Circle')
    expect(myFamily).toHaveLength(1)
    expect(careCircle).toHaveLength(1)
    expect(myFamily[0]).toMatchObject({ to: '/family/overview', icon: 'HeartPulse', group: 'dashboard' })
    expect(careCircle[0]).toMatchObject({ to: '/family', icon: 'Users', group: 'dashboard', end: true })
    expect(primaryNavigation.find((item) => item.to === '/my-care-plan')).toMatchObject({ label: 'My Care Plan', to: '/my-care-plan', icon: 'ClipboardList', group: 'dashboard' })
    expect(primaryNavigation.filter((item) => item.to === '/family' || item.to === '/family/overview')).toHaveLength(2)

    const dashboardIndex = primaryNavigation.findIndex((item) => item.to === '/dashboard')
    expect(primaryNavigation[dashboardIndex + 1].label).toBe('My Care Plan')
    expect(primaryNavigation[dashboardIndex + 2].label).toBe('My Family')
    expect(primaryNavigation[dashboardIndex + 3].label).toBe('Care Circle')

    renderNav('/dashboard')
    expect(screen.getAllByRole('link', { name: 'My Family' })).toHaveLength(1)
    expect(screen.getAllByRole('link', { name: 'Care Circle' })).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'My Family' })).toHaveAttribute('href', '/family/overview')
    expect(screen.getByRole('link', { name: 'Care Circle' })).toHaveAttribute('href', '/family')
    expect(labelsIn(document.querySelectorAll('.sidebar-group')[0])).toEqual(['Dashboard', 'My Care Plan', 'My Family', 'Care Circle'])
    expect(labelsIn(document.querySelectorAll('.sidebar-group')[1])).toEqual(['Book Care', 'Appointments', 'Home Care', 'AI Health Guardian'])
    expect(labelsIn(document.querySelectorAll('.sidebar-group')[2])).toEqual(['Health Records', 'Medical Documents', 'Prescriptions', 'Medications'])
    expect(screen.queryByRole('navigation', { name: 'Mobile navigation' }).querySelector('a[href="/family"], a[href="/family/overview"]')).toBeNull()
    const mobileLinks = within(screen.getByRole('navigation', { name: 'Mobile navigation' })).getAllByRole('link')
    expect(mobileLinks.slice(0, 3).map((link) => link.getAttribute('href'))).toEqual(['/dashboard', '/my-care-plan', '/appointments'])
  })

  it('activates only My Family on the family health overview', () => {
    renderNav('/family/overview')
    expect(screen.getByRole('link', { name: 'My Family' })).toHaveClass('active')
    expect(screen.getByRole('link', { name: 'Care Circle' })).not.toHaveClass('active')
  })

  it('activates only Care Circle on group management', () => {
    renderNav('/family')
    expect(screen.getByRole('link', { name: 'Care Circle' })).toHaveClass('active')
    expect(screen.getByRole('link', { name: 'My Family' })).not.toHaveClass('active')
  })
})

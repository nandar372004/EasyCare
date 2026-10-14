import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { SubscriptionPage } from './SubscriptionPage.jsx'

const renderPage = () => render(<MemoryRouter><SubscriptionPage /></MemoryRouter>)

function plan(name) {
  return screen.getAllByRole('heading', { name }).find(heading => heading.closest('.subscription-plans'))?.closest('article')
}

describe('Subscription page pricing', () => {
  it('shows the requested monthly prices and removes presentation messaging', () => {
    renderPage()

    expect(within(plan('Essential')).getByText('Free')).toBeInTheDocument()
    expect(within(plan('EasyCare Plus')).getByText('28,000 MMK')).toBeInTheDocument()
    expect(within(plan('Family Care')).getByText('32,000 MMK')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Monthly' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Safe presentation')).not.toBeInTheDocument()
    expect(screen.queryByText('No charge will be made')).not.toBeInTheDocument()
    expect(screen.queryByText(/This page demonstrates subscription choices only/)).not.toBeInTheDocument()
    expect(within(plan('Essential')).getByRole('button', { name: 'Selected' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('link', { name: 'Review payment presentation' })).toHaveAttribute('href', '/payments')
  })

  it('switches all prices to the requested yearly amounts and shows the 13 percent saving', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Yearly/ }))

    expect(screen.getByRole('button', { name: /Yearly/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Save 13%')).toBeInTheDocument()
    expect(within(plan('Essential')).getByText('Free')).toBeInTheDocument()
    expect(within(plan('EasyCare Plus')).getByText('292,320 MMK')).toBeInTheDocument()
    expect(within(plan('Family Care')).getByText('334,080 MMK')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }))
    expect(within(plan('EasyCare Plus')).getByText('28,000 MMK')).toBeInTheDocument()
    expect(within(plan('Family Care')).getByText('32,000 MMK')).toBeInTheDocument()
  })
})

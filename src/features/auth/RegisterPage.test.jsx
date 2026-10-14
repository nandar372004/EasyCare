import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { RegisterPage } from './RegisterPage.jsx'
import { LocalizationProvider } from '../localization/LocalizationContext.jsx'

const authMock = vi.hoisted(() => ({
  registerPrototype: vi.fn(),
}))

vi.mock('./AuthContext.jsx', () => ({
  useAuth: () => ({ isPrototypeMode: true, registerPrototype: authMock.registerPrototype }),
}))

function Destination() {
  const location = useLocation()
  return <div>Destination: {location.pathname}</div>
}

describe('patient Create Account page', () => {
  beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks() })

  it('switches labels, helper text, and validation messages without resetting values or consent', async () => {
    render(<MemoryRouter><LocalizationProvider><RegisterPage /></LocalizationProvider></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Example Patient' } })
    fireEvent.click(screen.getByLabelText('I agree to the Terms of Service'))
    fireEvent.click(screen.getByRole('button', { name: 'Myanmar', exact: true }))
    expect(screen.getByLabelText('အမည်အပြည့်အစုံ')).toHaveValue('Example Patient')
    expect(screen.getByLabelText('ဝန်ဆောင်မှု စည်းမျဉ်းစည်းကမ်းများကို သဘောတူပါသည်။')).toBeChecked()
    expect(screen.getByLabelText('စကားဝှက်အတည်ပြုရန်')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('သင့်ဖုန်းနံပါတ် ဖြည့်ပါ')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('သင့်စကားဝှက် ဖြည့်ပါ')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('စကားဝှက်ကို ထပ်မံဖြည့်ပါ')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('အမည်အပြည့်အစုံ ဖြည့်ပါ')).toHaveValue('Example Patient')
    expect(screen.getByText('အက္ခရာနှင့် ဂဏန်း ပါဝင်ပြီး အနည်းဆုံး စာလုံး ၈ လုံးရှိရပါမည်')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'အကောင့်ဖွင့်မည်' }))
    expect(await screen.findByText('ဖုန်းနံပါတ် ဖြည့်ပါ။')).toBeInTheDocument()
    expect(screen.getByText('စကားဝှက်တွင် အနည်းဆုံး စာလုံး ၈ လုံးရှိရပါမည်။')).toBeInTheDocument()
    expect(screen.getByText('မွေးသက္ကရာဇ် ဖြည့်ပါ။')).toBeInTheDocument()
    expect(sessionStorage.getItem('easycare-language')).toBe('my')
    fireEvent.click(screen.getByRole('button', { name: 'English', exact: true }))
    expect(screen.getByText('Phone number is required')).toBeInTheDocument()
    expect(screen.getByLabelText('Full Name')).toHaveValue('Example Patient')
    expect(screen.getByLabelText('Full Name')).not.toHaveAttribute('placeholder')
    expect(screen.getByRole('button', { name: 'Create Account', exact: true })).toBeInTheDocument()
    expect(authMock.registerPrototype).not.toHaveBeenCalled()
  })

  it('uses the saved Myanmar preference and keeps valid registration redirect unchanged', async () => {
    sessionStorage.setItem('easycare-language', 'my')
    render(<MemoryRouter initialEntries={['/register']}><LocalizationProvider><Routes><Route path="/register" element={<RegisterPage />} /><Route path="/onboarding" element={<Destination />} /></Routes></LocalizationProvider></MemoryRouter>)
    for (const [label, value] of [['ဖုန်းနံပါတ်', '09 123 456 789'], ['စကားဝှက်', 'EasyCare123'], ['စကားဝှက်အတည်ပြုရန်', 'EasyCare123'], ['အမည်အပြည့်အစုံ', 'Synthetic Patient'], ['မွေးသက္ကရာဇ်', '1995-04-12']]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    }
    fireEvent.click(screen.getByLabelText('ဝန်ဆောင်မှု စည်းမျဉ်းစည်းကမ်းများကို သဘောတူပါသည်။'))
    fireEvent.click(screen.getByLabelText('ကိုယ်ရေးအချက်အလက်ဆိုင်ရာ မူဝါဒနှင့် အချက်အလက်ကိုင်တွယ်ပုံကို ဖတ်ရှုနားလည်ပါသည်။'))
    fireEvent.click(screen.getByRole('button', { name: 'အကောင့်ဖွင့်မည်' }))
    expect(await screen.findByText('Destination: /onboarding')).toBeInTheDocument()
    expect(authMock.registerPrototype).toHaveBeenCalledWith('Synthetic Patient')
  })
  it('shows only the minimal registration fields and separate required acknowledgements', () => {
    render(<MemoryRouter><RegisterPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Create Your EasyCare Account' })).toBeInTheDocument()
    for (const label of ['Phone Number', 'Password', 'Confirm Password', 'Full Name', 'Date of Birth']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
    expect(screen.getByLabelText('I agree to the Terms of Service')).toBeRequired()
    expect(screen.getByLabelText('I acknowledge the Privacy Policy and information handling')).toBeRequired()
    for (const label of ['Gender', 'Address / City', 'Contact Person Name', 'Blood Type', 'Allergies', 'Existing Medical Conditions (optional)', 'Current Medications (optional)']) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument()
    }
  })

  it('blocks unchecked acknowledgements and routes a valid registration to onboarding', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/register']}><Routes>
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/onboarding" element={<Destination />} />
    </Routes></MemoryRouter>)
    await user.type(screen.getByLabelText('Phone Number'), '09 123 456 789')
    await user.type(screen.getByLabelText('Password'), 'EasyCare123')
    await user.type(screen.getByLabelText('Confirm Password'), 'EasyCare123')
    await user.type(screen.getByLabelText('Full Name'), 'Synthetic Patient')
    await user.type(screen.getByLabelText('Date of Birth'), '1995-04-12')
    await user.click(screen.getByRole('button', { name: 'Create Account' }))
    expect(await screen.findByText('You must agree to the Terms of Service')).toBeInTheDocument()
    expect(screen.getByText('You must acknowledge the Privacy Policy')).toBeInTheDocument()
    await user.click(screen.getByLabelText('I agree to the Terms of Service'))
    await user.click(screen.getByLabelText('I acknowledge the Privacy Policy and information handling'))
    await user.click(screen.getByRole('button', { name: 'Create Account' }))
    expect(await screen.findByText('Destination: /onboarding')).toBeInTheDocument()
    expect(authMock.registerPrototype).toHaveBeenCalledWith('Synthetic Patient')
  })
})

import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, Menu, X } from 'lucide-react'
import { Brand } from '../../components/Brand.jsx'

const navigation = [
  ['Home', 'home'], ['Services', 'services'], ['How It Works', 'how-it-works'],
  ['About EasyCare', 'about'], ['For Families', 'families'], ['Contact Us', 'contact'],
]

export function LandingNavbar({ activePage }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(activePage ?? 'home')
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (location.pathname !== '/' || !location.hash) return
    const id = location.hash.slice(1)
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [location.pathname, location.hash])

  useEffect(() => {
    if (activePage || !('IntersectionObserver' in window)) return undefined
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
      if (visible) setActive(visible.target.id)
    }, { rootMargin: '-25% 0px -65%', threshold: [0, .2, .6] })
    navigation.filter(([, id]) => id !== 'services').forEach(([, id]) => {
      const node = document.getElementById(id)
      if (node) observer.observe(node)
    })
    return () => observer.disconnect()
  }, [activePage])

  const goTo = (id) => {
    setOpen(false)
    if (id === 'services') { navigate('/services'); return }
    if (id === 'how-it-works') { navigate('/how-it-works'); return }
    if (id === 'about') { navigate('/about'); return }
    if (id === 'families') { navigate('/families'); return }
    if (id === 'contact') { navigate('/contact'); return }
    if (location.pathname !== '/') { navigate(`/#${id}`); return }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const links = navigation.map(([label, id]) => (
    <button key={id} type="button" className={(activePage ?? active) === id ? 'active' : ''} onClick={() => goTo(id)}>{label}</button>
  ))

  return <header className="ec-nav"><div className="ec-nav-inner"><button className="ec-logo-button" type="button" onClick={() => goTo('home')} aria-label="EasyCare home"><Brand /></button><nav className="ec-desktop-nav" aria-label="Main navigation">{links}</nav><div className="ec-nav-actions"><button className="ec-language" type="button" aria-label="Select language">EN <ChevronDown /></button><Link className="ec-button ec-button-outline ec-signin" to="/login">Sign In</Link><Link className="ec-button ec-button-primary ec-find" to="/doctors">Find Care</Link><button className="ec-menu-toggle" type="button" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button></div></div>{open && <nav className="ec-mobile-nav" aria-label="Mobile navigation">{links}<Link to="/login">Sign In</Link><Link className="ec-mobile-find" to="/doctors">Find Care</Link></nav>}</header>
}

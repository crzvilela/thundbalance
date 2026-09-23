import { auth } from '../firebase/auth'
import { signOut } from 'firebase/auth'
import { Link, useNavigate } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { EditableText, EditableImage, useSectionSelection, SectionEditOverlay } from './editor/Editable'
import { SectionBackgroundImage, sectionBackgroundStyle } from './editor/SectionBackground'
import { useLandingContent } from '../content/LandingContentContext'
import { useI18n } from '../i18n/I18nContext'
import LanguageSwitcher from './LanguageSwitcher'
import logo from '../assets/images/nuevo logo (1).png'

function Navbar() {

  const navigate = useNavigate()

  const user = auth.currentUser

  const [openMenu, setOpenMenu] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const navRef = useRef(null)

  const { content } = useLandingContent()
  const { t } = useI18n()

  const { section, isEditMode, isSelected, onSectionClick, visible, theme } = useSectionSelection('navbar')

  // Sections are now dynamic IDs, not fixed names, so the in-page anchor
  // links below need to look up whichever section instance currently has
  // that `type` (the first one, if the admin ever duplicates it) instead of
  // assuming a literal '#about' etc. id exists. Falls back to the old fixed
  // name if no such section exists (link just won't scroll anywhere, which
  // is harmless).
  const order = content.sectionOrder || []
  const findSectionIdByType = (type) => order.find((id) => content.sections[id]?.type === type)
  const aboutId = findSectionIdByType('about') || 'about'
  const servicesId = findSectionIdByType('services') || 'services'
  const pricingId = findSectionIdByType('pricing') || 'pricing'
  const contactId = findSectionIdByType('contact') || 'contact'

  const handleLogout = async () => {

    try {

      await signOut(auth)

      navigate('/')

    } catch (error) {

      console.log(error)

    }

  }

  // Mobile menu: close on click/tap outside the whole navbar, or on Escape.
  // The mobile menu is a public-site-only affordance (the admin editor is
  // desktop-only), so this effect and the menu markup below are both
  // skipped entirely in edit mode.
  useEffect(() => {
    if (isEditMode || !mobileMenuOpen) return

    const handleClickOutside = (e) => {
      if (navRef.current && !navRef.current.contains(e.target)) {
        setMobileMenuOpen(false)
      }
    }

    const handleEscape = (e) => {
      if (e.key === 'Escape') setMobileMenuOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isEditMode, mobileMenuOpen])

  if (!visible && !isEditMode) return null

  const brandBlock = (
    <div className="flex items-center gap-2 sm:gap-3">
      <EditableImage
        path="sections.navbar.logoImage"
        defaultSrc={logo}
        alt="Logo"
        containerClassName="h-8 w-auto sm:h-10"
        imageClassName="h-8 w-auto sm:h-10 object-contain"
        label="Navbar Logo"
      />
      {section.showBrandText !== false && (
        <EditableText
          as="span"
          path="sections.navbar.brand"
          styleObj="sections.navbar.brandStyle"
          label="Navbar Brand"
          className="text-lg sm:text-2xl tracking-[2px] sm:tracking-[4px] font-bold"
        />
      )}
    </div>
  )

  const guestLinks = [
    { href: `#${aboutId}`, label: t('nav_about') },
    { href: `#${servicesId}`, label: t('nav_services') },
    { href: `#${pricingId}`, label: t('nav_pricing') },
    { href: `#${contactId}`, label: t('nav_contact') }
  ]

  const userLinks = [
    { to: '/', label: t('nav_home') },
    { to: '/dashboard', label: t('nav_dashboard') },
    { to: '/profile', label: t('nav_profile') },
    { to: '/my-sessions', label: t('nav_sessions') }
  ]

  const activeLinks = !user ? guestLinks : userLinks

  // Links mix in-page anchors (href, scroll to a homepage section) and real
  // routes (to, e.g. the About Us page) in the same list, so render each
  // one with the right tag instead of assuming the whole list is one kind.
  const renderNavLink = (link, onLinkClick, className = 'hover:text-gray-400 transition duration-300') => (
    link.href ? (
      <a href={link.href} onClick={onLinkClick} className={className}>
        {link.label}
      </a>
    ) : (
      <Link to={link.to} onClick={onLinkClick} className={className}>
        {link.label}
      </Link>
    )
  )

  return (
    <nav
      ref={navRef}
      onClick={onSectionClick}
      className={`${isEditMode ? 'absolute' : 'fixed'} top-0 left-0 w-full z-50 px-3 sm:px-6 pt-4 sm:pt-6 ${!visible ? 'opacity-40' : ''}`}
    >

      <div
        className="relative isolate z-10 max-w-7xl mx-auto backdrop-blur-md bg-black/40 border border-white/10 rounded-2xl px-4 sm:px-6 md:px-8 py-3 sm:py-4 md:py-5 flex justify-between items-center"
        style={sectionBackgroundStyle(section.background)}
      >

        <SectionEditOverlay isEditMode={isEditMode} isSelected={isSelected} hidden={!visible} label="Navbar" />
        <SectionBackgroundImage background={section.background} wrapperClassName="rounded-2xl" />

        {isEditMode ? (
          brandBlock
        ) : (
          <Link
            to="/"
            className="hover:text-gray-400 transition duration-300"
          >
            {brandBlock}
          </Link>
        )}

        <div className="flex items-center gap-3 sm:gap-4 md:gap-10">

          <ul className="hidden md:flex gap-8 text-sm uppercase tracking-wider" style={{ fontFamily: theme.typography.accentFont }}>
            {activeLinks.map((link) => (
              <li key={link.href || link.to}>
                {renderNavLink(link)}
              </li>
            ))}
          </ul>

          {/* Hamburger — public site only, hidden from md up (desktop nav takes over) */}
          {!isEditMode && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setMobileMenuOpen((v) => !v)
              }}
              aria-label={mobileMenuOpen ? t('nav_aria_close_menu') : t('nav_aria_open_menu')}
              aria-expanded={mobileMenuOpen}
              className="md:hidden w-11 h-11 flex items-center justify-center rounded-lg hover:bg-white/10 transition shrink-0"
            >
              <div className="w-6 h-5 relative flex flex-col justify-between">
                <motion.span
                  animate={mobileMenuOpen ? { rotate: 45, y: 8.5 } : { rotate: 0, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="block h-0.5 w-full bg-white rounded-full origin-center"
                />
                <motion.span
                  animate={mobileMenuOpen ? { opacity: 0 } : { opacity: 1 }}
                  transition={{ duration: 0.15 }}
                  className="block h-0.5 w-full bg-white rounded-full"
                />
                <motion.span
                  animate={mobileMenuOpen ? { rotate: -45, y: -8.5 } : { rotate: 0, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="block h-0.5 w-full bg-white rounded-full origin-center"
                />
              </div>
            </button>
          )}

          {!isEditMode && <LanguageSwitcher className="hidden md:block" />}

          {!user ? (

            <div className="flex items-center gap-1.5 sm:gap-4" style={{ fontFamily: theme.typography.accentFont }}>

              <Link
                to="/training-tips"
                className="inline-flex items-center hover:text-gray-400 transition duration-300 uppercase text-xs md:text-sm px-1"
              >
                {t('nav_login')}
              </Link>

              <Link
                to="/register"
                className="inline-flex items-center border border-white/20 px-2.5 sm:px-3 md:px-4 py-2.5 rounded-lg hover:bg-white hover:text-black transition duration-300 uppercase text-xs md:text-sm whitespace-nowrap"
              >
                {t('nav_register')}
              </Link>

            </div>

          ) : (

            <div className="relative">

              <img
                src={
                  user.photoURL ||
                  'https://ui-avatars.com/api/?name=' +
                  encodeURIComponent(user.displayName || 'User')
                }
                alt="Profile"
                onClick={() => setOpenMenu(!openMenu)}
                className="w-11 h-11 sm:w-12 sm:h-12 rounded-full cursor-pointer border border-white/20 hover:scale-105 transition duration-300"
              />

              {openMenu && (

                <div className="absolute right-0 mt-4 w-56 bg-black border border-white/10 rounded-xl overflow-hidden">

                  <div className="p-4 border-b border-white/10">

                    <p className="font-semibold">
                      {user.displayName}
                    </p>

                    <p className="text-xs text-gray-400 truncate">
                      {user.email}
                    </p>

                  </div>

                  <Link
                    to="/dashboard"
                    className="block px-4 py-3 hover:bg-white/10 transition duration-300"
                  >
                    {t('nav_dashboard')}
                  </Link>

                  <Link
                    to="/profile"
                    className="block px-4 py-3 hover:bg-white/10 transition duration-300"
                  >
                    {t('nav_profile')}
                  </Link>

                  <Link
                    to="/my-sessions"
                    className="block px-4 py-3 hover:bg-white/10 transition duration-300"
                  >
                    {t('nav_my_sessions')}
                  </Link>

                  <Link
                    to="/book-session"
                    className="block px-4 py-3 hover:bg-white/10 transition duration-300"
                  >
                    {t('nav_book_session')}
                  </Link>

                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-3 text-red-400 hover:bg-red-500 hover:text-white transition duration-300"
                  >
                    {t('nav_logout')}
                  </button>

                </div>

              )}

            </div>

          )}

        </div>

      </div>

      {/* Mobile dropdown menu — public site only, below md */}
      {!isEditMode && (
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
              className="md:hidden relative z-10 max-w-7xl mx-auto mt-3 backdrop-blur-md bg-black/80 border border-white/10 rounded-2xl overflow-hidden"
            >
              <ul className="flex flex-col divide-y divide-white/10 text-sm uppercase tracking-wider" style={{ fontFamily: theme.typography.accentFont }}>
                {activeLinks.map((link) => (
                  <li key={link.href || link.to}>
                    {renderNavLink(link, () => setMobileMenuOpen(false), 'block px-6 py-4 hover:bg-white/10 transition duration-200')}
                  </li>
                ))}
              </ul>

              <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between">
                <span className="text-xs text-gray-500 uppercase tracking-wider">
                  {t('language_switcher_aria')}
                </span>
                <LanguageSwitcher />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}

    </nav>
  )
}

export default Navbar

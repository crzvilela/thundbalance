// Small line icons for the editor chrome (top bar, sections menu, panels).

const PATHS = {
  desktop: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  tablet: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M11 18h2" /></>,
  mobile: <><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M11 18.5h2" /></>,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>,
  redo: <><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M3 3l18 18" /><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.4 6.4A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4.2-.9" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></>,
  grip: <><circle cx="9" cy="6" r="1.2" /><circle cx="15" cy="6" r="1.2" /><circle cx="9" cy="12" r="1.2" /><circle cx="15" cy="12" r="1.2" /><circle cx="9" cy="18" r="1.2" /><circle cx="15" cy="18" r="1.2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  palette: <><path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2 0-.6-.3-1-.6-1.4-.3-.4-.4-.8-.4-1.2 0-.9.7-1.5 1.6-1.5H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8Z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="14.5" cy="7.5" r="1" /></>,
  more: <><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></>,
  back: <path d="m15 5-7 7 7 7" />,
  sidebar: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  navbar: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /></>,
  hero: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 12h8M10 15h4" /></>,
  about: <><rect x="3" y="4" width="18" height="16" rx="2" /><rect x="6" y="8" width="5" height="8" rx="1" /><path d="M14 9h4M14 12h4M14 15h3" /></>,
  services: <><rect x="3" y="5" width="5" height="14" rx="1" /><rect x="9.5" y="5" width="5" height="14" rx="1" /><rect x="16" y="5" width="5" height="14" rx="1" /></>,
  pricing: <><path d="M12 3v18M16.5 7.5C15.5 6.4 14 6 12 6c-2.4 0-4 1.1-4 3 0 4.5 8 2 8 6.5 0 1.9-1.6 3-4 3-2 0-3.6-.5-4.7-1.6" /></>,
  testimonials: <><path d="M4 5h16v11H9l-5 4V5Z" /><path d="M8 9h8M8 12h5" /></>,
  contact: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  textBlock: <><path d="M5 6h14M5 10h14M5 14h9M5 18h6" /></>,
  imageText: <><rect x="3" y="5" width="9" height="14" rx="1.5" /><path d="M15 8h6M15 12h6M15 16h4" /></>,
  videoBlock: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m10.5 9.5 4 2.5-4 2.5z" /></>,
  footer: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 15h18" /></>
}

export function EdIcon({ name, className = 'h-[18px] w-[18px]' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {PATHS[name] || PATHS.textBlock}
    </svg>
  )
}

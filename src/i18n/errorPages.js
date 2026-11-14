// Texts of the two pages that stand in for a missing page (404) and for a crash (error page), in the three languages of the site, and the
// rule that says where the "my area" button goes. Nothing technical is ever written in them.

export const ERROR_TEXT = {
  en: {
    notFoundTitle: 'Page not found',
    notFoundText: 'The page you are looking for does not exist or has moved. Let’s get you back on track.',
    home: 'Back to home', myArea: 'Go to my area', adminArea: 'Go to the admin panel', trainerArea: 'Go to my trainer area',
    errorTitle: 'Something went wrong',
    errorText: 'An unexpected problem stopped this page. Reloading usually fixes it. If it keeps happening, please contact the studio.',
    reload: 'Reload the page',
  },
  es: {
    notFoundTitle: 'Página no encontrada',
    notFoundText: 'La página que buscas no existe o ha cambiado de sitio. Te ayudamos a volver.',
    home: 'Volver al inicio', myArea: 'Ir a mi área', adminArea: 'Ir al panel de administración', trainerArea: 'Ir a mi área de entrenador',
    errorTitle: 'Algo salió mal',
    errorText: 'Un problema inesperado ha detenido esta página. Recargarla suele solucionarlo. Si sigue ocurriendo, ponte en contacto con el estudio.',
    reload: 'Recargar la página',
  },
  ca: {
    notFoundTitle: 'Pàgina no trobada',
    notFoundText: 'La pàgina que cerques no existeix o ha canviat de lloc. T’ajudem a tornar.',
    home: 'Tornar a l’inici', myArea: 'Anar a la meva àrea', adminArea: 'Anar al panell d’administració', trainerArea: 'Anar a la meva àrea d’entrenador',
    errorTitle: 'Alguna cosa ha anat malament',
    errorText: 'Un problema inesperat ha aturat aquesta pàgina. Recarregar-la sol solucionar-ho. Si continua passant, posa’t en contacte amb l’estudi.',
    reload: 'Recarregar la pàgina',
  },
}

export const textsFor = (language) => ERROR_TEXT[language] || ERROR_TEXT.en

// The second button of the 404, from what the site knows about the signed-in account (useRoles): nothing for a visitor.
//   admin -> the panel, a trainer who is not the admin -> the trainer area, any other signed-in account -> the client area.
export function areaFor(rolesState) {
  const status = rolesState?.status
  if (status === 'signed-out' || status === 'loading' || !status) return null
  if (rolesState?.roles?.is_admin) return { to: '/admin', labelKey: 'adminArea' }
  if (rolesState?.isTrainerOnly) return { to: '/trainer', labelKey: 'trainerArea' }
  return { to: '/dashboard', labelKey: 'myArea' }
}

// A page that crashes right after a new version was published usually asks for a file that no longer exists: reloading brings the new one.
export const isStaleBuildError = (error) => /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i.test(String(error?.message || error || ''))

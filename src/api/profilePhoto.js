export async function uploadProfilePhoto({ apiUrl, userId, token, file, fetchImpl = fetch }) {
  const body = new FormData()
  body.append('file', file)
  let response
  try {
    response = await fetchImpl(`${apiUrl}/profile/${userId}/photo`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body,
    })
  } catch {
    throw new Error('Não foi possível ligar ao servidor. Verifique a ligação e tente novamente.')
  }
  if (response.status === 404 || response.status === 405) {
    throw new Error('O servidor ainda não tem o carregamento de fotos disponível. É necessário publicar a atualização da API.')
  }
  if (response.status === 401) throw new Error('A sessão expirou. Inicie sessão novamente para carregar a foto.')
  if (response.status === 413) throw new Error('A foto é demasiado grande. Escolha uma imagem até 5 MB.')
  let result
  try { result = await response.json() } catch {
    throw new Error('O servidor não conseguiu processar a foto. Tente novamente mais tarde.')
  }
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Não foi possível carregar a foto. Tente novamente.')
  if (typeof result.url !== 'string' || !result.url.startsWith('/uploads/')) {
    throw new Error('O servidor não confirmou a gravação da foto. Tente novamente.')
  }
  return result.url
}

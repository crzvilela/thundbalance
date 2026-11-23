# Acesso escondido ao painel do admin

O painel do admin já não vive num endereço fixo e conhecido. Vive num **caminho secreto** gerado pelo servidor, que só o admin autenticado conhece. É uma camada **adicional** de ocultação: a segurança real continua a ser o login e a verificação de admin no servidor (`require_admin` em todas as rotas do painel). Nada disto a substitui.

As páginas públicas (início, privacidade, termos, aviso legal, cookies, login, registo) e a área do cliente **não mudam de endereço**.

> Nesta documentação nunca há valores reais: o caminho secreto não está escrito em código, no repositório, em variáveis de ambiente, em logs, em testes nem em respostas a quem não é admin.

## Como funciona

1. **Onde vive o valor.** Tabela `site_settings (key, value, updated_at)` (`backend/admin_access.py`). A chave `admin_path` guarda 14 caracteres aleatórios (`a-z` e `0-9`, módulo `secrets`). Cria-se **uma vez** (ao arrancar o servidor ou na primeira utilização) e não muda entre arranques; só muda se o admin pedir um novo. A criação é idempotente (`INSERT … ON CONFLICT DO NOTHING`).
2. **Quem o recebe.** Só o admin autenticado: vem na resposta de `GET /me/roles` (campo `admin_path`, ausente para qualquer outra pessoa) e em `GET …/access-path` (só admin). Um cliente, um treinador ou um visitante nunca o recebem.
3. **O router.** As rotas do painel já não estão no router estático nem no pacote público. A rota "qualquer outro endereço" (`src/routes/UnknownOrAdmin.jsx`) decide:
   - o primeiro segmento é o caminho secreto **e** o servidor confirmou que a pessoa é admin → monta o painel (`src/admin/AdminApp.jsx`, um chunk à parte que só se descarrega neste momento);
   - o primeiro segmento tem o formato do caminho (14 caracteres) e **não há sessão** → pergunta ao servidor (`POST /route-check`) se é o caminho certo; se for, mostra o login nesse mesmo endereço e, depois de entrar, o admin volta para lá; se não for, é a 404 normal;
   - o endereço antigo de administração (e variantes) → 404 normal para toda a gente; um **admin autenticado** é redirecionado para o endereço novo (links e favoritos antigos);
   - qualquer outro endereço → a 404 normal do site (mesmo componente, mesmo texto, sem redirecionar, sem pistas).
4. **Links do painel.** Tudo o que no painel é um link, um redirecionamento ou uma navegação usa `adminUrl('/clientes…')` (`src/admin/adminUrl.js`), que lê o caminho que o `AdminApp` acabou de receber. Não há endereços fixos no código (há um teste que o garante: `src/admin/adminUrl.test.js`).
5. **Emails à equipa.** Os links ao painel (pedidos de sessão de teste, mensagens de contacto, mudanças de data) usam `admin_url()` (`backend/admin_access.py`), que lê o caminho da base de dados. Se a base de dados falhar, o email sai na mesma com o link do site (o admin entra pelo login).
6. **Motores de busca.** `robots.txt`, `sitemap.xml`, `vercel.json` e `index.html` não mencionam o painel. As páginas do painel levam `noindex, nofollow`.

## A API do painel não revela que existe

Para qualquer pedido às rotas do painel **sem token, com token inválido ou de uma conta que não é admin**, a resposta é **idêntica à de uma rota inexistente** (mesmo estado 404, mesmo corpo, mesmos cabeçalhos), seja qual for o método ou o corpo: nada de 401, 403, 405 ou 422 que diga "aqui há alguma coisa". Faz-se num middleware (`admin_shield_and_scan_guard` em `backend/main.py`) que reescreve o caminho para um que não existe antes do roteamento. `require_admin` continua em cada rota como defesa em profundidade.

- Os 404 legítimos do painel ("cliente não encontrado") mantêm o seu texto próprio, diferente do 404 genérico (`{"detail":{"code":"not_found",…}}`), para o frontend os distinguir.
- No frontend (`src/api/admin.js`): se um pedido do painel recebe o 404 genérico com sessão ativa, renova o token (`getIdToken(true)`) e repete **uma vez**; se falhar outra vez, termina a sessão e vai para o login. Sem ciclos.
- Os pedidos de cliente e as rotas públicas não mudaram.

## Deteção de varrimento

Mais de **30** respostas "não encontrado" (rotas inexistentes e o 404 genérico do painel) ao mesmo endereço em **5 minutos** dão **429** durante **15 minutos** (limitador partilhado em base de dados, `web_safety.SharedRateLimit`, e `get_client_ip`). Não contam os 404 legítimos de recursos do próprio utilizador autenticado nem os ficheiros em falta de `/uploads/`. Só se guardam contagens: o endereço guarda-se com hash e nunca vai para os logs.

## `POST /route-check`

Corpo `{"segment": "…"}`; resposta **sempre** 200 com `{"match": true|false}` (um segmento errado, um corpo estragado ou um endereço que excedeu o limite: o mesmo `{"match": false}`). Compara em tempo constante (`hmac.compare_digest`), lê sempre a base de dados e tem limite estrito (10 por minuto por endereço). Serve só para o favorito do admin mostrar o login antes de haver sessão.

## Como acede o David

1. Entra por **/login** como qualquer pessoa. Depois de autenticado e confirmado como admin, o site leva-o ao painel.
2. Pode guardar o endereço do painel como favorito (aparece em **Estado del sistema → Ruta de acceso al panel**, com o botão "Copiar"). Se abrir o favorito sem sessão, vê o login nesse endereço e, depois de entrar, volta à página do favorito.
3. **Se perder o favorito**: basta entrar por /login. Não há nenhum passo manual.

## Regenerar o caminho

Em **Estado del sistema → Ruta de acceso al panel → Regenerar la ruta** (pede confirmação e avisa de que os favoritos e links antigos deixam de funcionar). O servidor gera um valor novo e invalida o anterior no momento. A ação fica no `admin_audit_log` (só a ação e o uid abreviado, **nunca o valor**) e o painel passa logo ao endereço novo.

## Onde está o código

| O quê | Onde |
|---|---|
| Valor, rota de verificação, rotação, travão ao varrimento | `backend/admin_access.py` |
| Middleware (404 idêntico + travão) | `backend/main.py` (`admin_shield_and_scan_guard`) |
| `admin_path` nos papéis | `backend/trainer_area.py` (`/me/roles`) |
| Links dos emails | `backend/emails/*` (`admin_url()`) |
| Router, painel, login com regresso | `src/routes/UnknownOrAdmin.jsx`, `src/admin/AdminApp.jsx`, `src/roles/afterLogin.js` |
| Helper de links | `src/admin/adminUrl.js` |
| Repetição do pedido | `src/api/admin.js` |
| Bloco nas definições | `src/admin/AccessPath.jsx` |
| Testes | `backend/test_admin_access.py`, `src/admin/adminUrl.test.js`, `src/routes/adminAccess.spec.jsx`, `src/api/admin.spec.jsx`, `tests/admin-chunks.mjs` |

## Verificar que ninguém descarrega o painel

`tests/admin-chunks.mjs` abre num Chromium real as páginas de um visitante e de um cliente, e falha se alguma pedir um chunk do painel. Só imprime PASS/FAIL (o caminho secreto não se imprime). Corre-se à mão com a build de auditoria (`tests/a11y/vite.config.mjs`), o servidor `tests/csp-server.mjs` e o backend de auditoria `tests/a11y/backend_server.py`; pode acrescentar-se ao CI como passo opcional.

## Limites

- O caminho esconde, não protege: quem tiver o endereço ainda precisa do login de admin.
- O limitador do varrimento conta por endereço; atrás de uma rede partilhada (um escritório, um operador móvel) um varrimento de outra pessoa pode abrandar quem partilha o endereço durante 15 minutos.
- Na documentação antiga de outros módulos (`docs/*.md`) aparecem os nomes das rotas da API do painel; isso descreve a API (que não responde a quem não é admin), não o endereço do painel no navegador.

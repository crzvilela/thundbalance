# Manter o servidor acordado (Render, plano gratuito)

## Porque é que isto não estava a resolver (diagnóstico)

O método que estava descrito aqui (UptimeRobot) **depende de uma conta externa criada à mão**, e nada no repositório mostra que foi feito. Sem esse pedido
periódico, o serviço adormece 15 minutos depois do último pedido e o seguinte demora cerca de um minuto (medido: 82,5 s em `/health`). Um pedido
feito pela própria página só acorda o servidor quando alguém já está a abrir o site, tarde demais para esse visitante.

## O que está implementado agora (sem contas nem serviços externos)

`backend/keepalive.py`: uma única thread (com trinco) que, **em produção**, faz `GET /health` ao endereço público do próprio serviço
(`RENDER_EXTERNAL_URL`, que a Render define sozinha) **a cada 10 minutos**, com timeout de 10 s e erros engolidos. Um pedido que entra pelo endereço público
conta como tráfego para a Render, por isso o serviço deixa de chegar aos 15 minutos de silêncio. Só arranca se `RENDER_EXTERNAL_URL` existir (https) e
`ENVIRONMENT`/`ENV` não for desenvolvimento. `KEEP_ALIVE=off` desliga-o. Não regista nenhum dado.

### O limite

Uma thread **não consegue acordar** um serviço que já está a dormir: se a Render o adormecer por manutenção, por um reinício ou por esgotar as horas
gratuitas, o primeiro pedido seguinte ainda pode demorar cerca de um minuto. A solução garantida é um **plano pago** (que não adormece). O tempo do
próprio arranque do Python é pequeno (cerca de 2,4 s a importar e 0,3 s a preparar a base de dados, medido em local) e quase todo o atraso é a Render a acordar o contentor.

## Alternativa externa (opcional, se alguma vez quiserem)

O plano gratuito do Render **adormece** o serviço depois de 15 minutos sem pedidos,
e o primeiro pedido seguinte demora cerca de um minuto a acordá-lo. É por isso que
o formulário de sessão de prova podia ficar "a carregar" muito tempo na primeira vez.

O site já se protege sozinho: ao abrir a página pede `GET /health` (responde de
imediato, sem base de dados) e vai buscar as horas dos primeiros dias, antes de a
pessoa chegar ao campo. Para que **nem sequer chegue a adormecer**, faça um pedido
periódico gratuito:

### UptimeRobot (gratuito, a cada 5 minutos)

1. Criar conta em https://uptimerobot.com (plano Free).
2. **Add New Monitor** → tipo **HTTP(s)**.
3. Nome: `ThundBalance API`.
4. URL: `https://<o-seu-servico>.onrender.com/health` (o endereço do serviço no Render).
5. Intervalo de monitorização: **5 minutes** (o mínimo do plano gratuito).
6. Guardar. (Se o monitor usar o método HEAD, `/health` também o aceita.)

## Limites do plano gratuito do Render (da documentação oficial)

- Adormece após **15 minutos** sem tráfego e demora cerca de **1 minuto** a acordar.
- **750 horas gratuitas por mês, por workspace**. Um serviço ligado 24 h durante um
  mês de 31 dias gasta 744 h, ou seja, cabe, mas com pouca folga e **só para um
  serviço**: com um segundo serviço gratuito a correr, as horas esgotam-se e o Render
  suspende todos os serviços gratuitos até ao início do mês seguinte.
- O Render pode reiniciar um serviço gratuito a qualquer momento.
- O disco é efémero (ficheiros enviados perdem-se ao reiniciar), e não há mais do
  que uma instância.

Uma alternativa é passar o serviço a um plano pago, que não adormece.

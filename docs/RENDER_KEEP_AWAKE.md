# Manter o servidor acordado (Render, plano gratuito)

O plano gratuito do Render **adormece** o serviço depois de 15 minutos sem pedidos,
e o primeiro pedido seguinte demora cerca de um minuto a acordá-lo. É por isso que
o formulário de sessão de prova podia ficar "a carregar" muito tempo na primeira vez.

O site já se protege sozinho: ao abrir a página pede `GET /health` (responde de
imediato, sem base de dados) e vai buscar as horas dos primeiros dias, antes de a
pessoa chegar ao campo. Para que **nem sequer chegue a adormecer**, faça um pedido
periódico gratuito:

## UptimeRobot (gratuito, a cada 5 minutos)

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

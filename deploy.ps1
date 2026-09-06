$origem = "C:\Users\marce\OneDrive - AEBJC\=========\thundbalance-landing-editor\thundbalance"
$destino = "C:\Projetos\thundbalance"

Write-Host "1. A copiar ficheiros atualizados..." -ForegroundColor Cyan

robocopy $origem $destino /E /XD node_modules dist venv __pycache__ .git uploads | Out-Null

Write-Host "   Copia concluida." -ForegroundColor Green

$configPath = Join-Path $destino "src\config.js"
$configContent = Get-Content $configPath -Raw

if ($configContent -match "localhost") {
    Write-Host ""
    Write-Host "ERRO: src/config.js ainda aponta para localhost!" -ForegroundColor Red
    Write-Host "Corrige isso antes de publicar (deve apontar para a API do Render)." -ForegroundColor Red
    Write-Host "Script cancelado." -ForegroundColor Red
    exit
}

Write-Host "2. config.js confirmado (aponta para producao)." -ForegroundColor Green

Set-Location $destino

Write-Host ""
Write-Host "3. Alteracoes detectadas:" -ForegroundColor Cyan
git status --short

Write-Host ""
$mensagem = Read-Host "Escreve uma descricao curta desta atualizacao (ex: Fix video card layout)"

if ([string]::IsNullOrWhiteSpace($mensagem)) {
    $mensagem = "Update project"
}

Write-Host ""
Write-Host "4. A enviar para o GitHub..." -ForegroundColor Cyan

git add .
git commit -m "$mensagem"
git push origin main

Write-Host ""
Write-Host "Concluido! O Vercel vai atualizar-se sozinho em 1-3 minutos." -ForegroundColor Green
Write-Host "Verifica em https://vercel.com/dashboard" -ForegroundColor Green

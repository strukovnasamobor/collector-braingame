# Quick smoke test against `wrangler dev`. Posts an empty 8×8 board state to
# the /dev/cogitator-move endpoint and prints the chosen move + timing.
#
# Run wrangler dev in another terminal first:
#   cd worker
#   npx wrangler dev
#
# Then from anywhere:
#   pwsh worker/scripts/test_worker_cogitator.ps1

$ErrorActionPreference = 'Stop'

# Build an empty 8×8 board: 8 rows × 8 cols of { player: 0, eliminated: false }
$row = @()
for ($c = 0; $c -lt 8; $c++) {
  $row += @{ player = 0; eliminated = $false }
}
$state = @()
for ($r = 0; $r -lt 8; $r++) {
  $state += , $row
}

$payload = @{
  state         = $state
  size          = 8
  phase         = 'place'
  lastPlaces    = $null
  currentPlayer = 1
} | ConvertTo-Json -Depth 6

Write-Host "POST http://127.0.0.1:8787/dev/cogitator-move"
Write-Host "  (initial empty 8x8, P1 to move, place phase)"
Write-Host ""

$t0 = Get-Date
try {
  $resp = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/dev/cogitator-move' `
    -Method Post -ContentType 'application/json' -Body $payload
  $dt = (Get-Date) - $t0
  Write-Host "Response in $([int]$dt.TotalMilliseconds) ms wall"
  Write-Host "Server inference time:  $($resp.ms) ms"
  if ($null -eq $resp.move) {
    Write-Host "Move: NULL (engine returned no move)"
  } else {
    Write-Host "Move: row=$($resp.move.row) col=$($resp.move.col)"
  }
} catch {
  Write-Host "ERROR: $($_.Exception.Message)"
  if ($_.ErrorDetails) {
    Write-Host $_.ErrorDetails.Message
  }
  exit 1
}

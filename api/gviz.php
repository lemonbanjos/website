<?php
/**
 * Cached proxy for Google Sheets gviz endpoint
 * Works great on AMPPS (local), while GitHub Pages uses static JSON.
 *
 * USAGE (from JS):
 *   fetch('./api/gviz.php?sheet=Options&tq=' + encodeURIComponent('select *'))
 *
 * Returns the ORIGINAL gviz body (starts with )]}' …) so your existing parser works unchanged.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

// === CONFIG ===
// Put your Google Sheet ID here (or load from env/secret if you prefer):
$SHEET_ID = '1JaKOJLDKDgEvIg54UKKg2J3fftwOsZlKBw1j5qjeheU';  // <-- change if needed
$TTL       = 120;                                   // cache time in seconds
$TIMEOUT_S = 10;                                    // upstream fetch timeout

// === INPUTS ===
$sheet = isset($_GET['sheet']) ? trim($_GET['sheet']) : '';
$tq    = isset($_GET['tq'])    ? (string)$_GET['tq'] : '';

if ($sheet === '') {
  http_response_code(400);
  echo json_encode(['error' => 'missing "sheet" parameter']);
  exit;
}

// === CACHE PREP ===
$CACHE_DIR = __DIR__ . '/cache';
if (!is_dir($CACHE_DIR)) { @mkdir($CACHE_DIR, 0777, true); }

$key  = md5($SHEET_ID . '|' . $sheet . '|' . $tq);
$file = $CACHE_DIR . '/' . $key . '.gviz.json';

$expired = !file_exists($file) || (time() - filemtime($file) > $TTL);

// === UPSTREAM URL ===
$query = http_build_query(['sheet' => $sheet, 'tq' => $tq, 'tqx' => 'out:json'], '', '&', PHP_QUERY_RFC3986);

$googleUrl = "https://docs.google.com/spreadsheets/d/{$SHEET_ID}/gviz/tq?{$query}";

// === FETCH (if needed) ===
if ($expired) {
  $ctx = stream_context_create(['http' => ['timeout' => $TIMEOUT_S]]);
  $resp = @file_get_contents($googleUrl, false, $ctx);

  if ($resp !== false && strlen($resp) > 0) {
    // Cache fresh body verbatim (gviz starts with )]}' then JSON)
    @file_put_contents($file, $resp);
  } elseif (!file_exists($file)) {
    // No cache to fall back to
    http_response_code(502);
    echo json_encode(['error' => 'upstream fetch failed', 'sheet' => $sheet]);
    exit;
  }
}

// === SERVE CACHED/NEW ===
$body = @file_get_contents($file);
if ($body === false) {
  http_response_code(500);
  echo json_encode(['error' => 'cache read failed']);
  exit;
}

// Mild browser/proxy cache headers (data itself is already cached on disk)
header('Cache-Control: public, max-age=0, s-maxage=60');

// Output the exact gviz payload (NOT re-encoded)
echo $body;

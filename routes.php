<?php
// Short-URL router for /editor/ and /creator/.
// Page files live under pages/; this serves them one level up so every
// relative link keeps working (one "../" level is trimmed).
$routes = [
    'editor'  => __DIR__ . '/pages/editor/index.html',
    'creator' => __DIR__ . '/pages/create/index.html',
];

$page = $_GET['page'] ?? '';
if (!isset($routes[$page]) || !is_file($routes[$page])) {
    http_response_code(404);
    exit('Not found.');
}

$html = file_get_contents($routes[$page]);
echo str_replace('../../', '../', $html);

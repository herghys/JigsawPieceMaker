<?php
// DB connection for the Jigsaw Piece Creator API (local MySQL for now).
// Direct browser access to this file is blocked; include from api/*.php only.
if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) {
    http_response_code(403);
    exit('Forbidden');
}

define('JIGSAW_DB_HOST', '127.0.0.1');
define('JIGSAW_DB_NAME', 'jigsaw');
define('JIGSAW_DB_USER', 'root');
define('JIGSAW_DB_PASS', ''); // XAMPP default. Set a password and update here for shared machines.

function jigsaw_pdo(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $pdo = new PDO(
            'mysql:host=' . JIGSAW_DB_HOST . ';dbname=' . JIGSAW_DB_NAME . ';charset=utf8mb4',
            JIGSAW_DB_USER,
            JIGSAW_DB_PASS,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]
        );
    }
    return $pdo;
}

<?php
// Knob profile CRUD. JSON in/out.
//   GET  ?action=list
//   GET  ?action=get&id=3
//   POST ?action=create          {slug?, name, description?, control_points:[[x,y],...]}
//   POST ?action=update          {id, name?, description?, control_points?}
//   POST ?action=delete          {id}
// Built-in profiles (is_builtin=1) can be edited but not deleted or re-slugged.

header('Content-Type: application/json; charset=utf-8');
require __DIR__ . '/config.php';

function out($data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_SLASHES);
    exit;
}

function body(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw ?: '[]', true);
    return is_array($data) ? $data : [];
}

/** Control-point rules: anchors fixed, 3+ points, numeric pairs. */
function valid_points($cp, ?string &$error): bool
{
    if (!is_array($cp) || count($cp) < 3) {
        $error = 'Need at least 3 control points.';
        return false;
    }
    foreach ($cp as $p) {
        if (!is_array($p) || count($p) !== 2 || !is_numeric($p[0]) || !is_numeric($p[1])) {
            $error = 'Each control point must be [x, y] numbers.';
            return false;
        }
    }
    if (abs((float) $cp[0][0]) > 0.001 || abs((float) $cp[0][1]) > 0.001) {
        $error = 'First point must be [0, 0].';
        return false;
    }
    $last = $cp[count($cp) - 1];
    if (abs((float) $last[0] - 1) > 0.001 || abs((float) $last[1]) > 0.001) {
        $error = 'Last point must be [1, 0].';
        return false;
    }
    $error = null;
    return true;
}

function valid_slug($slug, ?string &$error): bool
{
    if (!is_string($slug) || !preg_match('/^[a-z0-9_]{2,32}$/', $slug)) {
        $error = 'Slug must be 2-32 chars: lowercase letters, digits, underscore.';
        return false;
    }
    $error = null;
    return true;
}

function row_to_profile(array $row): array
{
    return [
        'id' => (int) $row['id'],
        'slug' => $row['slug'],
        'name' => $row['name'],
        'description' => $row['description'],
        'controlPoints' => json_decode($row['control_points'], true),
        'isBuiltin' => (bool) $row['is_builtin'],
    ];
}

try {
    $method = $_SERVER['REQUEST_METHOD'];
    $action = $_GET['action'] ?? 'list';

    // DB connectivity probe for page gating (welcome / editor).
    // Always HTTP 200. Callers branch on the "db" flag.
    if ($method === 'GET' && $action === 'status') {
        try {
            jigsaw_pdo()->query('SELECT 1');
            out(['ok' => true, 'db' => true]);
        } catch (Throwable $e) {
            out(['ok' => false, 'db' => false, 'error' => 'Database unreachable.']);
        }
    }

    $pdo = jigsaw_pdo();

    if ($method === 'GET' && $action === 'list') {
        $rows = $pdo->query('SELECT * FROM knob_profiles ORDER BY is_builtin DESC, id ASC')->fetchAll();
        out(['ok' => true, 'data' => array_map('row_to_profile', $rows)]);
    }

    if ($method === 'GET' && $action === 'get') {
        $stmt = $pdo->prepare('SELECT * FROM knob_profiles WHERE id = ?');
        $stmt->execute([(int) ($_GET['id'] ?? 0)]);
        $row = $stmt->fetch();
        if (!$row) out(['ok' => false, 'error' => 'Not found.'], 404);
        out(['ok' => true, 'data' => row_to_profile($row)]);
    }

    if ($method === 'POST' && $action === 'create') {
        $in = body();
        $name = trim((string) ($in['name'] ?? ''));
        if ($name === '' || mb_strlen($name) > 80) out(['ok' => false, 'error' => 'Name is required (max 80 chars).'], 422);
        $slug = (string) ($in['slug'] ?? strtolower(preg_replace('/[^a-z0-9]+/i', '_', $name)));
        $slug = trim($slug, '_');
        if (!valid_slug($slug, $err)) out(['ok' => false, 'error' => $err], 422);
        if (!valid_points($in['control_points'] ?? null, $err)) out(['ok' => false, 'error' => $err], 422);
        $stmt = $pdo->prepare('INSERT INTO knob_profiles (slug, name, description, control_points) VALUES (?, ?, ?, ?)');
        try {
            $stmt->execute([$slug, $name, mb_substr((string) ($in['description'] ?? ''), 0, 255), json_encode(array_values($in['control_points']))]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') out(['ok' => false, 'error' => 'Slug already exists.'], 409);
            throw $e;
        }
        $id = (int) $pdo->lastInsertId();
        $row = $pdo->query('SELECT * FROM knob_profiles WHERE id = ' . $id)->fetch();
        out(['ok' => true, 'data' => row_to_profile($row)], 201);
    }

    if ($method === 'POST' && $action === 'update') {
        $in = body();
        $id = (int) ($in['id'] ?? 0);
        $stmt = $pdo->prepare('SELECT * FROM knob_profiles WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) out(['ok' => false, 'error' => 'Not found.'], 404);

        $sets = [];
        $params = [];
        if (array_key_exists('name', $in)) {
            $name = trim((string) $in['name']);
            if ($name === '' || mb_strlen($name) > 80) out(['ok' => false, 'error' => 'Name is required (max 80 chars).'], 422);
            $sets[] = 'name = ?';
            $params[] = $name;
        }
        if (array_key_exists('description', $in)) {
            $sets[] = 'description = ?';
            $params[] = mb_substr((string) $in['description'], 0, 255);
        }
        if (array_key_exists('control_points', $in)) {
            if (!valid_points($in['control_points'], $err)) out(['ok' => false, 'error' => $err], 422);
            $sets[] = 'control_points = ?';
            $params[] = json_encode(array_values($in['control_points']));
        }
        if (array_key_exists('slug', $in) && !$row['is_builtin']) {
            if (!valid_slug($in['slug'], $err)) out(['ok' => false, 'error' => $err], 422);
            $sets[] = 'slug = ?';
            $params[] = $in['slug'];
        }
        if (!$sets) out(['ok' => false, 'error' => 'Nothing to update.'], 422);
        $params[] = $id;
        try {
            $pdo->prepare('UPDATE knob_profiles SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($params);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') out(['ok' => false, 'error' => 'Slug already exists.'], 409);
            throw $e;
        }
        $row = $pdo->query('SELECT * FROM knob_profiles WHERE id = ' . $id)->fetch();
        out(['ok' => true, 'data' => row_to_profile($row)]);
    }

    if ($method === 'POST' && $action === 'delete') {
        $in = body();
        $id = (int) ($in['id'] ?? 0);
        $stmt = $pdo->prepare('SELECT is_builtin FROM knob_profiles WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) out(['ok' => false, 'error' => 'Not found.'], 404);
        if ($row['is_builtin']) out(['ok' => false, 'error' => 'Built-in profiles cannot be deleted.'], 403);
        $pdo->prepare('DELETE FROM knob_profiles WHERE id = ?')->execute([$id]);
        out(['ok' => true, 'data' => ['id' => $id]]);
    }

    out(['ok' => false, 'error' => 'Unknown action.'], 404);
} catch (PDOException $e) {
    out(['ok' => false, 'error' => 'Database error: ' . $e->getMessage()], 500);
}

-- Jigsaw Piece Creator database (local MySQL for now; Supabase later).
-- Import: mysql -u root < db.sql   (or via phpMyAdmin)
-- Re-run note: CREATE TABLE IF NOT EXISTS + INSERT IGNORE style seeding
-- (re-import is safe; it will not duplicate the built-in profiles).

CREATE DATABASE IF NOT EXISTS jigsaw
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE jigsaw;

CREATE TABLE IF NOT EXISTS knob_profiles (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  slug          VARCHAR(32) NOT NULL UNIQUE,
  name          VARCHAR(80) NOT NULL,
  description   VARCHAR(255) NOT NULL DEFAULT '',
  -- JSON array of [x, y] control points. TEXT (not JSON type) for max
  -- MariaDB/MySQL compatibility. Validated in PHP before write.
  control_points TEXT NOT NULL,
  is_builtin    TINYINT(1) NOT NULL DEFAULT 0,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Built-in knob profiles shipped with the app.
-- Seeding is idempotent thanks to the UNIQUE slug + INSERT ... ON DUPLICATE KEY UPDATE.
INSERT INTO knob_profiles (slug, name, description, control_points, is_builtin) VALUES
('classic', 'Classic', 'Round head, narrow neck',
 '[[0,0],[0.34,0],[0.37,0.2],[0.33,0.4],[0.38,0.65],[0.5,0.85],[0.62,0.65],[0.67,0.4],[0.63,0.2],[0.66,0],[1,0]]', 1),
('classic_rounded', 'Classic Rounded', 'Classic with a slightly flatter head',
 '[[0,0],[0.34,0],[0.37,0.2],[0.33,0.4],[0.38,0.65],[0.5,0.75],[0.62,0.65],[0.67,0.4],[0.63,0.2],[0.66,0],[1,0]]', 1),
('rounded', 'Rounded', 'Soft wide bump, no pinched neck',
 '[[0,0],[0.34,0],[0.38,0.65],[0.5,0.85],[0.62,0.65],[0.66,0],[1,0]]', 1),
('bulb', 'Bulb', 'Tall round bulb with deep neck',
 '[[0,0],[0.38,0],[0.4,0.1],[0.32,0.35],[0.36,0.8],[0.5,1],[0.64,0.8],[0.68,0.35],[0.6,0.1],[0.62,0],[1,0]]', 1),
('arrowhead', 'Arrowhead', 'Pointed triangular-ish tab',
 '[[0,0],[0.36,0],[0.4,0.15],[0.35,0.3],[0.42,0.6],[0.5,0.8],[0.58,0.6],[0.65,0.3],[0.6,0.15],[0.64,0],[1,0]]', 1)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  control_points = VALUES(control_points),
  is_builtin = VALUES(is_builtin);

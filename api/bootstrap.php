<?php
define('DB_PATH', __DIR__ . '/../data.db');
define('UPLOAD_DIR', __DIR__ . '/../uploads');
define('UPLOAD_URL', 'uploads');

function getDb(): PDO {
    $dir = dirname(DB_PATH);
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    $pdo = new PDO('sqlite:' . DB_PATH);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec('PRAGMA foreign_keys = ON');

    $pdo->exec("DROP TABLE IF EXISTS admins");
    $pdo->exec("CREATE TABLE IF NOT EXISTS admin_ips (ip TEXT PRIMARY KEY)");
    $pdo->exec("CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, caption TEXT NOT NULL, image_url TEXT, type TEXT NOT NULL DEFAULT 'post', created_at TEXT NOT NULL DEFAULT (datetime('now')))");
    $pdo->exec("CREATE TABLE IF NOT EXISTS reactions (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, emoji TEXT NOT NULL, ip_address TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(post_id, emoji, ip_address))");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_reactions_post ON reactions(post_id)");
    $pdo->exec("CREATE TABLE IF NOT EXISTS survey_options (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, option_text TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0)");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_survey_options_post ON survey_options(post_id)");
    $pdo->exec("CREATE TABLE IF NOT EXISTS survey_votes (post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, option_id INTEGER NOT NULL REFERENCES survey_options(id) ON DELETE CASCADE, ip_address TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (post_id, ip_address))");

    // Migrate: drop admin_id from posts if present (SQLite 3.35+)
    $cols = $pdo->query("PRAGMA table_info(posts)")->fetchAll(PDO::FETCH_ASSOC);
    foreach ($cols as $c) {
        if ($c['name'] === 'admin_id') {
            try {
                $pdo->exec("ALTER TABLE posts DROP COLUMN admin_id");
            } catch (Throwable $e) {}
            break;
        }
    }

    // Ensure type column exists (legacy)
    try {
        $pdo->exec("ALTER TABLE posts ADD COLUMN type TEXT DEFAULT 'post'");
    } catch (Throwable $e) {}

    // Seed admin IPs from env (comma-separated) or default localhost
    $stmt = $pdo->query("SELECT COUNT(*) FROM admin_ips");
    if ($stmt && (int) $stmt->fetchColumn() === 0) {
        $ips = getenv('ADMIN_IPS') ? array_map('trim', explode(',', getenv('ADMIN_IPS'))) : ['127.0.0.1', '::1'];
        $ins = $pdo->prepare("INSERT OR IGNORE INTO admin_ips (ip) VALUES (?)");
        foreach ($ips as $ip) {
            if ($ip !== '') $ins->execute([$ip]);
        }
    }

    return $pdo;
}

function clientIp(): string {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $ips = array_map('trim', explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']));
        $ip = $ips[0] ?: $ip;
    }
    return $ip;
}

function isAdmin(): bool {
    $pdo = getDb();
    $stmt = $pdo->prepare("SELECT 1 FROM admin_ips WHERE ip = ?");
    $stmt->execute([clientIp()]);
    return (bool) $stmt->fetch();
}

function requireAdmin(): void {
    if (!isAdmin()) {
        header('Content-Type: application/json');
        http_response_code(401);
        echo json_encode(['error' => 'Unauthorized']);
        exit;
    }
}

<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit(0);

require_once __DIR__ . '/bootstrap.php';

$ip = clientIp();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $pdo = getDb();
    $stmt = $pdo->query("SELECT id, caption, image_url, created_at, type FROM posts ORDER BY created_at DESC");
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $posts = [];
    foreach ($rows as $r) {
        $type = isset($r['type']) && $r['type'] === 'survey' ? 'survey' : 'post';
        $post = ['id' => (int) $r['id'], 'caption' => $r['caption'], 'image' => $r['image_url'] ?: null, 'createdAt' => $r['created_at'], 'type' => $type];
        if ($type === 'survey') {
            $stmtOpt = $pdo->prepare("SELECT o.id, o.option_text, o.sort_order, (SELECT COUNT(*) FROM survey_votes v WHERE v.option_id = o.id) AS votes FROM survey_options o WHERE o.post_id = ? ORDER BY o.sort_order, o.id");
            $stmtOpt->execute([$r['id']]);
            $post['options'] = [];
            while ($opt = $stmtOpt->fetch(PDO::FETCH_ASSOC)) {
                $post['options'][] = ['id' => (int) $opt['id'], 'text' => $opt['option_text'], 'votes' => (int) $opt['votes']];
            }
            $stmtVote = $pdo->prepare("SELECT option_id FROM survey_votes WHERE post_id = ? AND ip_address = ?");
            $stmtVote->execute([$r['id'], $ip]);
            $myVote = $stmtVote->fetch(PDO::FETCH_ASSOC);
            $post['myVote'] = $myVote ? (int) $myVote['option_id'] : null;
        }
        $posts[] = $post;
    }
    echo json_encode($posts);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAdmin();

    $caption = '';
    $type = 'post';
    $image = null;
    $options = [];

    if (!empty($_FILES['image']['tmp_name']) && $_FILES['image']['error'] === UPLOAD_ERR_OK) {
        $file = $_FILES['image'];
        $allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
        if (in_array($mime, $allowed, true)) {
            $ext = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/gif' => 'gif', 'image/webp' => 'webp'][$mime];
            $dir = UPLOAD_DIR . '/' . date('Y') . '/' . date('m');
            if (!is_dir($dir)) mkdir($dir, 0755, true);
            $name = bin2hex(random_bytes(8)) . '.' . $ext;
            if (move_uploaded_file($file['tmp_name'], $dir . '/' . $name)) {
                $image = UPLOAD_URL . '/' . date('Y') . '/' . date('m') . '/' . $name;
            }
        }
    }

    if (!empty($_POST['caption'])) {
        $caption = trim((string) $_POST['caption']);
        $type = (!empty($_POST['type']) && $_POST['type'] === 'survey') ? 'survey' : 'post';
        if (!empty($_POST['options'])) {
            $decoded = json_decode($_POST['options'], true);
            $options = is_array($decoded) ? $decoded : [];
        }
    } else {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];
        $caption = isset($data['caption']) ? trim((string) $data['caption']) : '';
        $type = isset($data['type']) && $data['type'] === 'survey' ? 'survey' : 'post';
        $options = isset($data['options']) && is_array($data['options']) ? $data['options'] : [];
        if ($image === null && isset($data['image']) && trim((string) $data['image']) !== '') {
            $t = strtolower(trim((string) $data['image']));
            if (substr($t, 0, 7) === 'http://' || substr($t, 0, 8) === 'https://' || strpos($t, 'uploads/') === 0) {
                $image = trim((string) $data['image']);
            }
        }
    }

    if ($caption === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Caption required']);
        exit;
    }
    if ($type === 'survey') {
        $options = array_values(array_filter(array_map(function ($o) {
            return is_string($o) ? trim($o) : (isset($o['text']) ? trim($o['text']) : '');
        }, $options)));
        if (count($options) < 2) {
            http_response_code(400);
            echo json_encode(['error' => 'Survey needs at least 2 options']);
            exit;
        }
    }

    $pdo = getDb();
    $pdo->prepare("INSERT INTO posts (caption, image_url, type) VALUES (?, ?, ?)")->execute([$caption, $image, $type]);
    $postId = (int) $pdo->lastInsertId();

    if ($type === 'survey') {
        $stmtOpt = $pdo->prepare("INSERT INTO survey_options (post_id, option_text, sort_order) VALUES (?, ?, ?)");
        foreach ($options as $i => $text) {
            if ($text !== '') $stmtOpt->execute([$postId, $text, $i]);
        }
    }

    $stmt = $pdo->prepare("SELECT id, caption, image_url, created_at, type FROM posts WHERE id = ?");
    $stmt->execute([$postId]);
    $r = $stmt->fetch(PDO::FETCH_ASSOC);
    $out = ['id' => (int) $r['id'], 'caption' => $r['caption'], 'image' => $r['image_url'] ?: null, 'createdAt' => $r['created_at'], 'type' => $r['type'] === 'survey' ? 'survey' : 'post'];
    if ($out['type'] === 'survey') {
        $stmtO = $pdo->prepare("SELECT id, option_text FROM survey_options WHERE post_id = ? ORDER BY sort_order, id");
        $stmtO->execute([$postId]);
        $out['options'] = [];
        while ($o = $stmtO->fetch(PDO::FETCH_ASSOC)) {
            $out['options'][] = ['id' => (int) $o['id'], 'text' => $o['option_text'], 'votes' => 0];
        }
        $out['myVote'] = null;
    }
    echo json_encode($out);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    requireAdmin();
    $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
    if ($id < 1) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid id']);
        exit;
    }
    $pdo = getDb();
    $stmt = $pdo->prepare("SELECT image_url FROM posts WHERE id = ?");
    $stmt->execute([$id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        http_response_code(404);
        echo json_encode(['error' => 'Post not found']);
        exit;
    }
    $imageUrl = $row['image_url'];
    if ($imageUrl && strpos($imageUrl, 'uploads/') === 0) {
        $path = UPLOAD_DIR . '/' . substr($imageUrl, 8);
        if (file_exists($path)) @unlink($path);
    }
    $pdo->prepare("DELETE FROM posts WHERE id = ?")->execute([$id]);
    echo json_encode(['ok' => true]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);

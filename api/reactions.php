<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit(0);

require_once __DIR__ . '/bootstrap.php';

$ip = clientIp();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $pdo = getDb();
    $postIds = [];
    if (!empty($_GET['post_ids'])) {
        foreach (explode(',', $_GET['post_ids']) as $id) {
            $id = (int) trim($id);
            if ($id > 0) $postIds[] = $id;
        }
    }
    if (empty($postIds)) {
        echo json_encode([]);
        exit;
    }
    $placeholders = implode(',', array_fill(0, count($postIds), '?'));
    $stmt = $pdo->prepare("SELECT post_id, emoji, COUNT(*) AS cnt FROM reactions WHERE post_id IN ($placeholders) GROUP BY post_id, emoji");
    $stmt->execute($postIds);
    $byPost = [];
    foreach ($postIds as $id) {
        $byPost[(string) $id] = ['counts' => [], 'mine' => []];
    }
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $byPost[(string) $row['post_id']]['counts'][$row['emoji']] = (int) $row['cnt'];
    }
    $stmt = $pdo->prepare("SELECT post_id, emoji FROM reactions WHERE post_id IN ($placeholders) AND ip_address = ?");
    $stmt->execute(array_merge($postIds, [$ip]));
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $byPost[(string) $row['post_id']]['mine'][] = $row['emoji'];
    }
    echo json_encode($byPost);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$raw = file_get_contents('php://input');
$data = json_decode($raw, true) ?: [];
$postId = isset($data['post_id']) ? (int) $data['post_id'] : 0;
$optionId = isset($data['option_id']) ? (int) $data['option_id'] : 0;

if ($postId < 1) {
    http_response_code(400);
    echo json_encode(['error' => 'post_id required']);
    exit;
}

$pdo = getDb();

if ($optionId > 0) {
    $stmt = $pdo->prepare("SELECT type FROM posts WHERE id = ?");
    $stmt->execute([$postId]);
    $post = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$post || $post['type'] !== 'survey') {
        http_response_code(400);
        echo json_encode(['error' => 'Not a survey']);
        exit;
    }
    $stmt = $pdo->prepare("SELECT id FROM survey_options WHERE id = ? AND post_id = ?");
    $stmt->execute([$optionId, $postId]);
    if (!$stmt->fetch()) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid option']);
        exit;
    }
    $pdo->prepare("INSERT OR REPLACE INTO survey_votes (post_id, option_id, ip_address) VALUES (?, ?, ?)")->execute([$postId, $optionId, $ip]);
    $stmt = $pdo->prepare("SELECT o.id, o.option_text, (SELECT COUNT(*) FROM survey_votes v WHERE v.option_id = o.id) AS votes FROM survey_options o WHERE o.post_id = ? ORDER BY o.sort_order, o.id");
    $stmt->execute([$postId]);
    $options = [];
    while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $options[] = ['id' => (int) $r['id'], 'text' => $r['option_text'], 'votes' => (int) $r['votes']];
    }
    $stmt = $pdo->prepare("SELECT option_id FROM survey_votes WHERE post_id = ? AND ip_address = ?");
    $stmt->execute([$postId, $ip]);
    $myVote = $stmt->fetch(PDO::FETCH_ASSOC);
    echo json_encode(['options' => $options, 'myVote' => $myVote ? (int) $myVote['option_id'] : null]);
    exit;
}

$emoji = isset($data['emoji']) ? trim((string) $data['emoji']) : '';
$allowed = ['❤️', '👍', '🎨', '💻', '🔥', '✨', '🙌', '💜'];
if ($emoji === '' || !in_array($emoji, $allowed, true)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid emoji']);
    exit;
}
try {
    $pdo->prepare("INSERT INTO reactions (post_id, emoji, ip_address) VALUES (?, ?, ?)")->execute([$postId, $emoji, $ip]);
} catch (PDOException $e) {
    if (strpos($e->getMessage(), 'UNIQUE') !== false) {
        http_response_code(409);
        echo json_encode(['error' => 'Already reacted with this emoji']);
        exit;
    }
    throw $e;
}
$stmt = $pdo->prepare("SELECT emoji, COUNT(*) AS cnt FROM reactions WHERE post_id = ? GROUP BY emoji");
$stmt->execute([$postId]);
$counts = [];
while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
    $counts[$row['emoji']] = (int) $row['cnt'];
}
$stmt = $pdo->prepare("SELECT emoji FROM reactions WHERE post_id = ? AND ip_address = ?");
$stmt->execute([$postId, $ip]);
$mine = [];
while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
    $mine[] = $row['emoji'];
}
echo json_encode(['counts' => $counts, 'mine' => $mine]);

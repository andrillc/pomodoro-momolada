<?php
require __DIR__ . '/_bootstrap.php';
$u = current_user();
$uid = (int)$u['id'];
$pdo = db();
$action = s('action', 20) ?: 'list';

function find_pair($a, $b) {
    $st = db()->prepare('SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)');
    $st->execute([$a, $b, $b, $a]);
    return $st->fetch() ?: null;
}
function card(array $r) {
    return ['id' => (int)$r['id'], 'username' => $r['username'], 'display_name' => $r['display_name'],
            'avatar_url' => $r['avatar_url']];
}

switch ($action) {
    case 'search': // busca por username (prefixo)
        $q = strtolower(s('q', 30));
        if (strlen($q) < 2) fail('Digite ao menos 2 caracteres.');
        $st = $pdo->prepare("SELECT u.id, u.username, u.display_name, u.avatar_url, f.status, f.requester_id
            FROM users u
            LEFT JOIN friendships f ON (f.requester_id = u.id AND f.addressee_id = ?) OR (f.requester_id = ? AND f.addressee_id = u.id)
            WHERE u.username LIKE ? AND u.id <> ? ORDER BY u.username LIMIT 10");
        $st->execute([$uid, $uid, like_escape($q) . '%', $uid]);
        $res = [];
        foreach ($st->fetchAll() as $r) {
            $rel = 'none';
            if ($r['status'] === 'accepted') $rel = 'friends';
            elseif ($r['status'] === 'pending') $rel = ((int)$r['requester_id'] === $uid) ? 'sent' : 'received';
            $res[] = card($r) + ['relation' => $rel];
        }
        out(['users' => $res]);

    case 'request':
        require_post();
        $target = null;
        if (s('username', 40) !== '') {
            $st = $pdo->prepare('SELECT * FROM users WHERE username = ?');
            $st->execute([strtolower(s('username', 40))]);
            $target = $st->fetch();
        } elseif (n('user_id')) {
            $target = user_by_id(n('user_id'));
        }
        if (!$target) fail('Usuário não encontrado.', 404);
        $tid = (int)$target['id'];
        if ($tid === $uid) fail('Você não pode adicionar a si mesmo.');
        $f = find_pair($uid, $tid);
        if (!$f) {
            $pdo->prepare('INSERT INTO friendships (requester_id, addressee_id) VALUES (?, ?)')->execute([$uid, $tid]);
            out(['status' => 'pending'], 201);
        }
        if ($f['status'] === 'accepted') fail('Vocês já são amigos.', 409);
        if ($f['status'] === 'pending') {
            if ((int)$f['requester_id'] === $uid) fail('Solicitação já enviada.', 409);
            // a outra pessoa já tinha pedido: aceita direto
            $pdo->prepare("UPDATE friendships SET status = 'accepted' WHERE id = ?")->execute([$f['id']]);
            out(['status' => 'accepted']);
        }
        // rejected
        if ((int)$f['requester_id'] === $uid) fail('Esta solicitação foi recusada.', 409);
        $pdo->prepare("UPDATE friendships SET requester_id = ?, addressee_id = ?, status = 'pending' WHERE id = ?")
            ->execute([$uid, $tid, $f['id']]);
        out(['status' => 'pending']);

    case 'respond':
        require_post();
        $fid = n('friendship_id');
        $decision = b('accept') ? 'accepted' : 'rejected';
        $st = $pdo->prepare("UPDATE friendships SET status = ? WHERE id = ? AND addressee_id = ? AND status = 'pending'");
        $st->execute([$decision, $fid, $uid]);
        if (!$st->rowCount()) fail('Solicitação não encontrada.', 404);
        out(['status' => $decision]);

    case 'pending':
        $in = $pdo->prepare("SELECT f.id AS friendship_id, u.id, u.username, u.display_name, u.avatar_url
            FROM friendships f JOIN users u ON u.id = f.requester_id
            WHERE f.addressee_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC");
        $in->execute([$uid]);
        $outg = $pdo->prepare("SELECT f.id AS friendship_id, u.id, u.username, u.display_name, u.avatar_url
            FROM friendships f JOIN users u ON u.id = f.addressee_id
            WHERE f.requester_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC");
        $outg->execute([$uid]);
        $map = function ($r) { return card($r) + ['friendship_id' => (int)$r['friendship_id']]; };
        out(['incoming' => array_map($map, $in->fetchAll()), 'outgoing' => array_map($map, $outg->fetchAll())]);

    case 'list': // amigos + presença (use em polling a cada 20–30 s)
        $st = $pdo->prepare("SELECT u.id, u.username, u.display_name, u.avatar_url, u.pomodoro_title,
                u.presence_status, u.last_seen_at, COALESCE(s.current_streak, 0) AS current_streak,
                (SELECT COUNT(*) FROM streak_boosts b WHERE b.sender_id = ? AND b.receiver_id = u.id AND b.boost_date = ?) AS boosted_today
            FROM friendships f
            JOIN users u ON u.id = IF(f.requester_id = ?, f.addressee_id, f.requester_id)
            LEFT JOIN streaks s ON s.user_id = u.id
            WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?)
            ORDER BY u.display_name");
        $st->execute([$uid, local_date(), $uid, $uid, $uid]);
        $list = [];
        foreach ($st->fetchAll() as $r) {
            $list[] = card($r) + ['pomodoro_title' => $r['pomodoro_title'], 'presence' => presence_of($r),
                'current_streak' => (int)$r['current_streak'], 'boosted_today' => (int)$r['boosted_today'] > 0];
        }
        out(['friends' => $list, 'server_now_ms' => time() * 1000]);

    case 'remove':
        require_post();
        $fid = n('friend_id');
        $pdo->prepare("DELETE FROM friendships WHERE status = 'accepted'
            AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))")
            ->execute([$uid, $fid, $fid, $uid]);
        out(['ok' => true]);

    default:
        fail('Ação desconhecida.', 404);
}

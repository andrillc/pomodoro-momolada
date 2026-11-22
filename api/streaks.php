<?php
require __DIR__ . '/_bootstrap.php';
$u = current_user();
$uid = (int)$u['id'];
$pdo = db();
$action = s('action', 20) ?: 'get';

switch ($action) {
    case 'get':
        out(['streak' => streak_refresh($uid), 'server_now_ms' => time() * 1000]);

    case 'log_focus': // chamar ao concluir cada ciclo de foco
        require_post();
        $dur = n('duration_minutes');
        if ($dur < 1 || $dur > 240) fail('Duração inválida (1 a 240 min).');
        $tag = s('subject_tag', 60) ?: null;
        $room = n('room_id') ?: null;
        if ($room) {
            $st = $pdo->prepare("SELECT 1 FROM room_participants WHERE room_id = ? AND user_id = ? AND invite_status = 'joined'");
            $st->execute([$room, $uid]);
            if (!$st->fetchColumn()) $room = null;
        }
        $pdo->prepare('INSERT INTO focus_logs (user_id, duration_minutes, subject_tag, room_id) VALUES (?,?,?,?)')
            ->execute([$uid, $dur, $tag, $room]);
        out(['streak' => streak_refresh($uid)], 201);

    case 'set_goal':
        require_post();
        $g = n('daily_goal_minutes');
        if ($g < 1 || $g > 600) fail('Meta diária: de 1 a 600 minutos.');
        $pdo->prepare('INSERT INTO streaks (user_id, daily_goal_minutes) VALUES (?, ?)
                       ON DUPLICATE KEY UPDATE daily_goal_minutes = VALUES(daily_goal_minutes)')->execute([$uid, $g]);
        out(['streak' => streak_refresh($uid)]);

    case 'reveal_freeze': // o front chama depois de mostrar a animação surpresa
        require_post();
        $st = $pdo->prepare('UPDATE streaks SET freeze_unlocked_revealed = 1 WHERE user_id = ? AND streak_freezes > 0');
        $st->execute([$uid]);
        out(['streak' => streak_refresh($uid)]);

    case 'boost': // 1 impulso por dia por par
        require_post();
        $fid = n('friend_id');
        if ($fid === $uid || !are_friends($uid, $fid)) fail('Só é possível dar impulso a amigos.', 403);
        try {
            $pdo->prepare('INSERT INTO streak_boosts (sender_id, receiver_id, boost_date) VALUES (?,?,?)')
                ->execute([$uid, $fid, local_date()]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') fail('Você já deu impulso a este amigo hoje.', 409);
            throw $e;
        }
        out(['ok' => true], 201);

    case 'boosts': // impulsos recebidos hoje
        $st = $pdo->prepare('SELECT u.id, u.username, u.display_name, u.avatar_url
            FROM streak_boosts b JOIN users u ON u.id = b.sender_id
            WHERE b.receiver_id = ? AND b.boost_date = ? ORDER BY b.created_at DESC');
        $st->execute([$uid, local_date()]);
        out(['boosts' => $st->fetchAll()]);

    default:
        fail('Ação desconhecida.', 404);
}

<?php
require __DIR__ . '/_bootstrap.php';
$u = current_user();
$uid = (int)$u['id'];
$pdo = db();
$action = s('action', 20) ?: 'list';

function dur(array $r, $phase) { return ($phase === 'focus' ? (int)$r['focus_minutes'] : (int)$r['break_minutes']) * 60; }
function ts($d) { return $d ? strtotime($d . ' UTC') : null; }

/** Sala ativa em que o usuário já entrou (+ tempos do anfitrião). */
function load_room($rid, $uid, $lock = false) {
    $st = db()->prepare("SELECT r.*, h.focus_minutes, h.break_minutes
        FROM study_rooms r
        JOIN users h ON h.id = r.host_id
        JOIN room_participants p ON p.room_id = r.id AND p.user_id = ? AND p.invite_status = 'joined'
        WHERE r.id = ? AND r.is_active = 1" . ($lock ? ' FOR UPDATE' : ''));
    $st->execute([$uid, $rid]);
    $r = $st->fetch();
    if (!$r) fail('Sala não encontrada ou sem acesso.', 404);
    return $r;
}

/** Quando phase_end_at passa, o servidor troca a fase (foco↔pausa) e deixa a sala em 'idle'. */
function tick(array $r, $uid) {
    if ($r['timer_state'] === 'running' && $r['phase_end_at'] && ts($r['phase_end_at']) <= time()) {
        $next = $r['timer_phase'] === 'focus' ? 'break' : 'focus';
        $st = db()->prepare("UPDATE study_rooms SET timer_state = 'idle', timer_phase = ?, phase_end_at = NULL, remaining_seconds = ?
                             WHERE id = ? AND timer_state = 'running' AND phase_end_at = ?");
        $st->execute([$next, dur($r, $next), $r['id'], $r['phase_end_at']]);
        return load_room((int)$r['id'], $uid); // relê (outro polling pode ter feito a troca)
    }
    return $r;
}

function view(array $r) {
    $pdo = db();
    $st = $pdo->prepare("SELECT p.user_id, p.invite_status, p.joined_at, u.username, u.display_name, u.avatar_url,
            u.pomodoro_title, u.theme, u.focus_minutes, u.break_minutes, u.presence_status, u.last_seen_at
        FROM room_participants p JOIN users u ON u.id = p.user_id
        WHERE p.room_id = ? AND p.invite_status IN ('invited','joined') ORDER BY p.joined_at");
    $st->execute([$r['id']]);
    $members = []; $joined = [];
    foreach ($st->fetchAll() as $m) {
        $members[] = ['user_id' => (int)$m['user_id'], 'username' => $m['username'], 'display_name' => $m['display_name'],
            'avatar_url' => $m['avatar_url'], 'invite_status' => $m['invite_status'], 'presence' => presence_of($m),
            'is_host' => (int)$m['user_id'] === (int)$r['host_id'],
            // personalização individual (relevante no modo independent)
            'pomodoro_title' => $m['pomodoro_title'], 'theme' => $m['theme'],
            'focus_minutes' => (int)$m['focus_minutes'], 'break_minutes' => (int)$m['break_minutes']];
        if ($m['invite_status'] === 'joined') $joined[] = (int)$m['user_id'];
    }
    $tasks = [];
    if ($r['mode'] === 'independent' && $joined) { // cada um mostra suas tarefas na sala
        $ids = implode(',', $joined); // inteiros vindos do banco
        $tq = $pdo->query("SELECT user_id, id, title, priority, is_completed FROM tasks WHERE user_id IN ($ids) ORDER BY user_id, position LIMIT 300");
        foreach ($tq->fetchAll() as $t) {
            $tasks[(int)$t['user_id']][] = ['id' => (int)$t['id'], 'title' => $t['title'],
                'priority' => $t['priority'], 'is_completed' => (int)$t['is_completed'] === 1];
        }
    }
    $endMs = ts($r['phase_end_at']) ? ts($r['phase_end_at']) * 1000 : null;
    $running = $r['timer_state'] === 'running';
    $rem = $running ? max(0, (int)ceil(($endMs - microtime(true) * 1000) / 1000))
                    : (int)($r['remaining_seconds'] ?: dur($r, $r['timer_phase']));
    return ['room' => [
        'id' => (int)$r['id'], 'host_id' => (int)$r['host_id'], 'mode' => $r['mode'],
        'timer_state' => $r['timer_state'], 'timer_phase' => $r['timer_phase'],
        'phase_end_at_ms' => $endMs, 'remaining_seconds' => $rem, 'server_now_ms' => (int)floor(microtime(true) * 1000),
        'members' => $members, 'tasks' => $tasks,
    ]];
}

switch ($action) {
    case 'create':
        require_post();
        $mode = s('mode', 20) ?: 'synced';
        if (!in_array($mode, ['synced', 'independent'], true)) fail('Modo inválido.');
        $fid = n('friend_id');
        if ($fid === $uid || !are_friends($uid, $fid)) fail('Convide apenas amigos.', 403);
        $c = $pdo->prepare('SELECT COUNT(*) FROM study_rooms WHERE host_id = ? AND is_active = 1');
        $c->execute([$uid]);
        if ((int)$c->fetchColumn() >= 3) fail('Limite de 3 salas ativas. Encerre alguma antes.', 429);
        $pdo->beginTransaction();
        $pdo->prepare('INSERT INTO study_rooms (host_id, mode, remaining_seconds) VALUES (?,?,?)')
            ->execute([$uid, $mode, (int)$u['focus_minutes'] * 60]);
        $rid = (int)$pdo->lastInsertId();
        $pdo->prepare("INSERT INTO room_participants (room_id, user_id, invite_status, joined_at) VALUES (?,?, 'joined', UTC_TIMESTAMP())")
            ->execute([$rid, $uid]);
        $pdo->prepare("INSERT INTO room_participants (room_id, user_id, invite_status) VALUES (?,?, 'invited')")
            ->execute([$rid, $fid]);
        $pdo->commit();
        out(view(load_room($rid, $uid)), 201);

    case 'invite': // anfitrião convida mais um amigo
        require_post();
        $rid = n('room_id'); $fid = n('friend_id');
        $r = load_room($rid, $uid);
        if ((int)$r['host_id'] !== $uid) fail('Só o anfitrião convida.', 403);
        if ($fid === $uid || !are_friends($uid, $fid)) fail('Convide apenas amigos.', 403);
        $pdo->prepare("INSERT INTO room_participants (room_id, user_id, invite_status) VALUES (?,?, 'invited')
            ON DUPLICATE KEY UPDATE invite_status = IF(invite_status IN ('declined','left'), 'invited', invite_status)")
            ->execute([$rid, $fid]);
        out(view(load_room($rid, $uid)));

    case 'invitations':
        $st = $pdo->prepare("SELECT r.id AS room_id, r.mode, r.created_at, h.username, h.display_name, h.avatar_url
            FROM room_participants p JOIN study_rooms r ON r.id = p.room_id AND r.is_active = 1
            JOIN users h ON h.id = r.host_id
            WHERE p.user_id = ? AND p.invite_status = 'invited' ORDER BY r.created_at DESC");
        $st->execute([$uid]);
        out(['invitations' => $st->fetchAll()]);

    case 'respond':
        require_post();
        $rid = n('room_id');
        $st = $pdo->prepare("SELECT 1 FROM room_participants p JOIN study_rooms r ON r.id = p.room_id AND r.is_active = 1
            WHERE p.room_id = ? AND p.user_id = ? AND p.invite_status = 'invited'");
        $st->execute([$rid, $uid]);
        if (!$st->fetchColumn()) fail('Convite não encontrado.', 404);
        if (b('accept')) {
            $pdo->prepare("UPDATE room_participants SET invite_status = 'joined', joined_at = UTC_TIMESTAMP() WHERE room_id = ? AND user_id = ?")
                ->execute([$rid, $uid]);
            out(view(load_room($rid, $uid)));
        }
        $pdo->prepare("UPDATE room_participants SET invite_status = 'declined' WHERE room_id = ? AND user_id = ?")->execute([$rid, $uid]);
        out(['ok' => true]);

    case 'list':
        $st = $pdo->prepare("SELECT r.id, r.mode, r.timer_state, r.timer_phase, h.display_name AS host_name
            FROM room_participants p JOIN study_rooms r ON r.id = p.room_id AND r.is_active = 1
            JOIN users h ON h.id = r.host_id
            WHERE p.user_id = ? AND p.invite_status = 'joined' ORDER BY r.created_at DESC");
        $st->execute([$uid]);
        out(['rooms' => $st->fetchAll()]);

    case 'get': // polling a cada 3–5 s; o front calcula o relógio com phase_end_at_ms e server_now_ms
        $r = tick(load_room(n('room_id'), $uid), $uid);
        out(view($r));

    case 'start': case 'resume': case 'pause': case 'reset': case 'skip':
        require_post();
        $rid = n('room_id');
        $pdo->beginTransaction();
        $r = tick(load_room($rid, $uid, true), $uid);
        if ($r['mode'] !== 'synced') fail('Sala independente: cada participante usa o próprio timer.', 409);
        $phase = $r['timer_phase'];
        if ($action === 'start' || $action === 'resume') {
            if ($r['timer_state'] !== 'running') {
                $secs = (int)($r['remaining_seconds'] ?: dur($r, $phase));
                $pdo->prepare("UPDATE study_rooms SET timer_state = 'running', phase_end_at = ?, remaining_seconds = NULL WHERE id = ?")
                    ->execute([gmdate('Y-m-d H:i:s', time() + $secs), $rid]);
            }
        } elseif ($action === 'pause') {
            if ($r['timer_state'] === 'running') {
                $rem = max(1, ts($r['phase_end_at']) - time());
                $pdo->prepare("UPDATE study_rooms SET timer_state = 'paused', phase_end_at = NULL, remaining_seconds = ? WHERE id = ?")
                    ->execute([$rem, $rid]);
            }
        } elseif ($action === 'reset') {
            $pdo->prepare("UPDATE study_rooms SET timer_state = 'idle', phase_end_at = NULL, remaining_seconds = ? WHERE id = ?")
                ->execute([dur($r, $phase), $rid]);
        } else { // skip: pula para a outra fase
            $next = $phase === 'focus' ? 'break' : 'focus';
            $pdo->prepare("UPDATE study_rooms SET timer_state = 'idle', timer_phase = ?, phase_end_at = NULL, remaining_seconds = ? WHERE id = ?")
                ->execute([$next, dur($r, $next), $rid]);
        }
        $pdo->commit();
        out(view(load_room($rid, $uid)));

    case 'leave':
        require_post();
        $rid = n('room_id');
        $r = load_room($rid, $uid);
        $pdo->prepare("UPDATE room_participants SET invite_status = 'left' WHERE room_id = ? AND user_id = ?")->execute([$rid, $uid]);
        if ((int)$r['host_id'] === $uid) { // anfitrião saiu: encerra
            $pdo->prepare("UPDATE study_rooms SET is_active = 0, timer_state = 'idle', phase_end_at = NULL WHERE id = ?")->execute([$rid]);
        }
        out(['ok' => true]);

    case 'close':
        require_post();
        $st = $pdo->prepare("UPDATE study_rooms SET is_active = 0, timer_state = 'idle', phase_end_at = NULL WHERE id = ? AND host_id = ?");
        $st->execute([n('room_id'), $uid]);
        if (!$st->rowCount()) fail('Sala não encontrada.', 404);
        out(['ok' => true]);

    default:
        fail('Ação desconhecida.', 404);
}

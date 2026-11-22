<?php
require __DIR__ . '/_bootstrap.php';
$admin = current_user();
// verificação sempre no banco (não só na sessão)
if ((int)$admin['is_admin'] !== 1) fail('Acesso negado.', 403);
$aid = (int)$admin['id'];
$pdo = db();
$action = s('action', 20) ?: 'list';

function target($id) {
    $t = user_by_id($id);
    if (!$t) fail('Usuário não encontrado.', 404);
    return $t;
}

switch ($action) {
    case 'search':
        $q = strtolower(s('q', 60));
        if (strlen($q) < 2) fail('Digite ao menos 2 caracteres.');
        $like = like_escape($q) . '%';
        $st = $pdo->prepare('SELECT id, username, email, display_name, plan_type FROM users
                             WHERE username LIKE ? OR email LIKE ? ORDER BY username LIMIT 20');
        $st->execute([$like, $like]);
        out(['users' => $st->fetchAll()]);

    case 'list':
        $st = $pdo->query("SELECT u.id, u.username, u.email, u.display_name, s.notes, s.granted_by, s.updated_at
            FROM users u JOIN subscriptions s ON s.user_id = u.id
            WHERE u.plan_type = 'vip_manual' ORDER BY s.updated_at DESC");
        out(['vips' => $st->fetchAll()]);

    case 'grant':
        require_post();
        $t = target(n('user_id')); $tid = (int)$t['id'];
        $notes = s('notes', 255) ?: null;
        $pdo->beginTransaction();
        $pdo->prepare('INSERT IGNORE INTO subscriptions (user_id) VALUES (?)')->execute([$tid]);
        $st = $pdo->prepare('SELECT * FROM subscriptions WHERE user_id = ? FOR UPDATE');
        $st->execute([$tid]);
        $sub = $st->fetch();
        if ($sub['plan'] === 'pro' && $sub['status'] === 'active' && in_array($sub['source'], ['mercadopago', 'stripe'], true)) {
            fail('Usuário já possui assinatura paga ativa.', 409);
        }
        $pdo->prepare("UPDATE subscriptions SET plan = 'pro', source = 'manual_admin', granted_by = ?, notes = ?,
                       status = 'active', current_period_end = NULL WHERE user_id = ?")->execute([$aid, $notes, $tid]);
        $pdo->prepare("UPDATE users SET plan_type = 'vip_manual' WHERE id = ?")->execute([$tid]);
        $pdo->commit();
        out(['ok' => true, 'user_id' => $tid, 'plan_type' => 'vip_manual']);

    case 'revoke':
        require_post();
        $t = target(n('user_id')); $tid = (int)$t['id'];
        $pdo->beginTransaction();
        $st = $pdo->prepare('SELECT * FROM subscriptions WHERE user_id = ? FOR UPDATE');
        $st->execute([$tid]);
        $sub = $st->fetch();
        if (!$sub || $sub['source'] !== 'manual_admin') fail('Usuário não tem VIP manual.', 409);
        $pdo->prepare("UPDATE subscriptions SET plan = 'free', source = 'none', granted_by = NULL, status = 'canceled',
                       notes = ? WHERE user_id = ?")->execute([s('notes', 255) ?: null, $tid]);
        $pdo->prepare("UPDATE users SET plan_type = 'free' WHERE id = ?")->execute([$tid]);
        $pdo->commit();
        out(['ok' => true, 'user_id' => $tid, 'plan_type' => 'free']);

    default:
        fail('Ação desconhecida.', 404);
}

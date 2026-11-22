<?php
require __DIR__ . '/_bootstrap.php';
$u = current_user();
$uid = (int)$u['id'];
$pdo = db();
$action = s('action', 20) ?: 'list';
const PRIOS = ['low', 'medium', 'high'];

function fmt(array $t) {
    return ['id' => (int)$t['id'], 'title' => $t['title'], 'priority' => $t['priority'],
            'is_completed' => (int)$t['is_completed'] === 1, 'position' => (int)$t['position'],
            'subject_tag' => $t['subject_tag'], 'created_at' => $t['created_at']];
}
function own($id, $uid) {
    $st = db()->prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?');
    $st->execute([$id, $uid]);
    $t = $st->fetch();
    if (!$t) fail('Tarefa não encontrada.', 404);
    return $t;
}

switch ($action) {
    case 'list':
        $st = $pdo->prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY position, id');
        $st->execute([$uid]);
        out(['tasks' => array_map('fmt', $st->fetchAll())]);

    case 'create':
        require_post();
        $title = s('title', 255);
        $prio = s('priority', 10) ?: 'low';
        $tag = s('subject_tag', 60) ?: null;
        if ($title === '') fail('Informe o título da tarefa.');
        if (!in_array($prio, PRIOS, true)) fail('Prioridade inválida.');
        $st = $pdo->prepare('SELECT COALESCE(MAX(position) + 1, 0) FROM tasks WHERE user_id = ?');
        $st->execute([$uid]);
        $pos = (int)$st->fetchColumn();
        $pdo->prepare('INSERT INTO tasks (user_id, title, priority, position, subject_tag) VALUES (?,?,?,?,?)')
            ->execute([$uid, $title, $prio, $pos, $tag]);
        out(['task' => fmt(own((int)$pdo->lastInsertId(), $uid))], 201);

    case 'update':
        require_post();
        $id = n('id'); own($id, $uid);
        $in = input(); $set = []; $val = [];
        if (array_key_exists('title', $in)) {
            $t = s('title', 255); if ($t === '') fail('Título vazio.');
            $set[] = 'title = ?'; $val[] = $t;
        }
        if (array_key_exists('priority', $in)) {
            $p = s('priority', 10); if (!in_array($p, PRIOS, true)) fail('Prioridade inválida.');
            $set[] = 'priority = ?'; $val[] = $p;
        }
        if (array_key_exists('subject_tag', $in)) { $set[] = 'subject_tag = ?'; $val[] = s('subject_tag', 60) ?: null; }
        if (array_key_exists('is_completed', $in)) { $set[] = 'is_completed = ?'; $val[] = b('is_completed') ? 1 : 0; }
        if (!$set) fail('Nada para atualizar.');
        array_push($val, $id, $uid);
        $pdo->prepare('UPDATE tasks SET ' . implode(', ', $set) . ' WHERE id = ? AND user_id = ?')->execute($val);
        out(['task' => fmt(own($id, $uid))]);

    case 'toggle':
        require_post();
        $id = n('id'); own($id, $uid);
        $pdo->prepare('UPDATE tasks SET is_completed = 1 - is_completed WHERE id = ? AND user_id = ?')->execute([$id, $uid]);
        out(['task' => fmt(own($id, $uid))]);

    case 'priority':
        require_post();
        $id = n('id'); own($id, $uid);
        $p = s('priority', 10);
        if (!in_array($p, PRIOS, true)) fail('Prioridade inválida.');
        $pdo->prepare('UPDATE tasks SET priority = ? WHERE id = ? AND user_id = ?')->execute([$p, $id, $uid]);
        out(['task' => fmt(own($id, $uid))]);

    case 'delete':
        require_post();
        $id = n('id'); own($id, $uid);
        $pdo->prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?')->execute([$id, $uid]);
        out(['ok' => true]);

    case 'reorder': // ids = [3,1,2] na ordem final (drag-and-drop)
        require_post();
        $ids = input()['ids'] ?? null;
        if (!is_array($ids) || !$ids || count($ids) > 500) fail('Lista de ids inválida.');
        $ids = array_values(array_unique(array_map('intval', $ids)));
        $ph = implode(',', array_fill(0, count($ids), '?'));
        $st = $pdo->prepare("SELECT COUNT(*) FROM tasks WHERE user_id = ? AND id IN ($ph)");
        $st->execute(array_merge([$uid], $ids));
        if ((int)$st->fetchColumn() !== count($ids)) fail('Há tarefas que não pertencem a você.', 403);
        $pdo->beginTransaction();
        $up = $pdo->prepare('UPDATE tasks SET position = ? WHERE id = ? AND user_id = ?');
        foreach ($ids as $i => $id) $up->execute([$i, $id, $uid]);
        $pdo->commit();
        out(['ok' => true]);

    default:
        fail('Ação desconhecida.', 404);
}

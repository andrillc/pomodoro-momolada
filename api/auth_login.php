<?php
require __DIR__ . '/_bootstrap.php';
$action = s('action', 30) ?: 'me';
$pdo = db();

switch ($action) {
    case 'register':
        require_post();
        $email = strtolower(s('email', 190));
        $pass = (string)(input()['password'] ?? '');
        $username = strtolower(s('username', 30));
        $display = s('display_name', 100) ?: $username;
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('E-mail inválido.');
        if (strlen($pass) < 8 || strlen($pass) > 200) fail('A senha deve ter de 8 a 200 caracteres.');
        if (!preg_match('/^[a-z0-9_]{3,30}$/', $username)) fail('Usuário: 3 a 30 caracteres (a-z, 0-9, _).');
        try {
            $id = create_user($email, password_hash($pass, PASSWORD_DEFAULT), $username, $display, null, null);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') fail('E-mail ou usuário já cadastrado.', 409);
            throw $e;
        }
        login_session($id);
        out(['user' => public_user(user_by_id($id))], 201);

    case 'login':
        require_post();
        $ident = strtolower(s('login', 190));
        $pass = (string)(input()['password'] ?? '');
        $st = $pdo->prepare('SELECT * FROM users WHERE email = ? OR username = ? LIMIT 1');
        $st->execute([$ident, $ident]);
        $u = $st->fetch();
        if (!$u || !$u['password_hash'] || !password_verify($pass, $u['password_hash'])) {
            usleep(400000); // freia tentativas de força bruta
            fail('Credenciais inválidas.', 401);
        }
        if (password_needs_rehash($u['password_hash'], PASSWORD_DEFAULT)) {
            $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?')
                ->execute([password_hash($pass, PASSWORD_DEFAULT), $u['id']]);
        }
        login_session($u['id']);
        out(['user' => public_user($u)]);

    case 'logout':
        require_post();
        if (!empty($_SESSION['uid'])) {
            $pdo->prepare("UPDATE users SET presence_status = 'offline' WHERE id = ?")->execute([$_SESSION['uid']]);
        }
        $_SESSION = [];
        session_destroy();
        out(['ok' => true]);

    case 'me':
        $u = current_user(false);
        if (!$u) out(['user' => null]);
        out(['user' => public_user($u), 'streak' => streak_refresh((int)$u['id']), 'server_now_ms' => time() * 1000]);

    case 'update_profile': // título editável, tema, tempos
        require_post();
        $u = current_user();
        $set = []; $val = [];
        $in = input();
        if (array_key_exists('pomodoro_title', $in)) {
            $t = s('pomodoro_title', 100);
            if ($t === '') fail('O título não pode ficar vazio.');
            $set[] = 'pomodoro_title = ?'; $val[] = $t;
        }
        if (array_key_exists('display_name', $in)) {
            $t = s('display_name', 100);
            if ($t === '') fail('Nome inválido.');
            $set[] = 'display_name = ?'; $val[] = $t;
        }
        if (array_key_exists('theme', $in)) {
            $t = strtolower(s('theme', 40));
            if (!preg_match('/^[a-z0-9_-]{1,40}$/', $t)) fail('Tema inválido.');
            $set[] = 'theme = ?'; $val[] = $t;
        }
        if (array_key_exists('focus_minutes', $in)) {
            $m = n('focus_minutes');
            if ($m < 1 || $m > 180) fail('Foco: de 1 a 180 minutos.');
            $set[] = 'focus_minutes = ?'; $val[] = $m;
        }
        if (array_key_exists('break_minutes', $in)) {
            $m = n('break_minutes');
            if ($m < 1 || $m > 60) fail('Pausa: de 1 a 60 minutos.');
            $set[] = 'break_minutes = ?'; $val[] = $m;
        }
        if (!$set) fail('Nada para atualizar.');
        $val[] = $u['id'];
        $pdo->prepare('UPDATE users SET ' . implode(', ', $set) . ' WHERE id = ?')->execute($val);
        out(['user' => public_user(user_by_id((int)$u['id']))]);

    case 'heartbeat': // presença (chamar a cada ~30–60 s)
        require_post();
        $u = current_user();
        $status = s('status', 10);
        if (!in_array($status, ['online', 'focusing', 'break'], true)) $status = 'online';
        $pdo->prepare('UPDATE users SET presence_status = ?, last_seen_at = UTC_TIMESTAMP() WHERE id = ?')
            ->execute([$status, $u['id']]);
        out(['ok' => true, 'server_now_ms' => time() * 1000]);

    default:
        fail('Ação desconhecida.', 404);
}

<?php
require __DIR__ . '/_bootstrap.php';
require_post();

function http_get($url) {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_SSL_VERIFYPEER => true]);
        $r = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return ($r !== false && $code === 200) ? $r : null;
    }
    $r = @file_get_contents($url, false, stream_context_create(['http' => ['timeout' => 8]]));
    return $r === false ? null : $r;
}

$clientId = cfg('google_client_id');
if (!$clientId || strpos($clientId, 'SEU_CLIENT_ID') === 0) fail('Login com Google não configurado.', 500);

$cred = s('credential', 4096);
if ($cred === '' || substr_count($cred, '.') !== 2) fail('Credencial inválida.');

// Valida assinatura/expiração no endpoint oficial do Google
$raw = http_get('https://oauth2.googleapis.com/tokeninfo?id_token=' . urlencode($cred));
$p = $raw ? json_decode($raw, true) : null;
if (!is_array($p)) fail('Não foi possível validar o token do Google.', 401);

if (($p['aud'] ?? '') !== $clientId) fail('Token emitido para outro app.', 401);
if (!in_array($p['iss'] ?? '', ['accounts.google.com', 'https://accounts.google.com'], true)) fail('Emissor inválido.', 401);
if ((int)($p['exp'] ?? 0) < time()) fail('Token expirado.', 401);
if (($p['email_verified'] ?? '') !== 'true' && ($p['email_verified'] ?? false) !== true) fail('E-mail do Google não verificado.', 401);

$sub = (string)($p['sub'] ?? '');
$email = strtolower((string)($p['email'] ?? ''));
if ($sub === '' || $email === '') fail('Token incompleto.', 401);
$name = mb_substr(trim((string)($p['name'] ?? '')), 0, 100);
$pic = (string)($p['picture'] ?? '');
$pic = (strlen($pic) <= 255 && strpos($pic, 'https://') === 0) ? $pic : null;

$pdo = db();
$st = $pdo->prepare('SELECT * FROM users WHERE google_sub = ?');
$st->execute([$sub]);
$u = $st->fetch();

if (!$u) {
    $st = $pdo->prepare('SELECT * FROM users WHERE email = ?');
    $st->execute([$email]);
    $u = $st->fetch();
    if ($u) { // vincula conta existente
        $pdo->prepare('UPDATE users SET google_sub = ?, avatar_url = COALESCE(avatar_url, ?) WHERE id = ?')
            ->execute([$sub, $pic, $u['id']]);
        $u = user_by_id((int)$u['id']);
    }
}

if (!$u) { // cria conta + streaks + subscriptions
    $base = preg_replace('/[^a-z0-9_]/', '', strtolower(strstr($email, '@', true)));
    $base = substr($base !== '' ? $base : 'user', 0, 24);
    if (strlen($base) < 3) $base .= '123';
    $username = $base;
    $chk = $pdo->prepare('SELECT 1 FROM users WHERE username = ?');
    for ($i = 0; $i < 8; $i++) {
        $chk->execute([$username]);
        if (!$chk->fetchColumn()) break;
        $username = $base . random_int(100, 99999);
    }
    try {
        $id = create_user($email, null, $username, $name ?: $username, $sub, $pic);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') fail('Conflito ao criar conta. Tente novamente.', 409);
        throw $e;
    }
    $u = user_by_id($id);
}

login_session((int)$u['id']);
out(['user' => public_user($u), 'streak' => streak_refresh((int)$u['id'])]);

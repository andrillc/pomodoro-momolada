<?php
$CFG = require __DIR__ . '/config.php';
date_default_timezone_set('UTC');

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function cfg($k, $d = null) { global $CFG; return isset($CFG[$k]) ? $CFG[$k] : $d; }
function out(array $d, $code = 200) {
    http_response_code($code);
    echo json_encode($d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function fail($m, $code = 400) { out(['error' => $m], $code); }

set_exception_handler(function ($e) {
    error_log((string)$e);
    out(['error' => cfg('debug') ? $e->getMessage() : 'Erro interno.'], 500);
});

// ---------- sessão ----------
$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
      || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
ini_set('session.gc_maxlifetime', '2592000');
session_name('pomodoro_sid');
session_set_cookie_params([
    'lifetime' => 2592000, 'path' => '/', 'secure' => $https,
    'httponly' => true, 'samesite' => 'Lax',
]);
session_start();

// ---------- banco ----------
function db() {
    static $pdo = null;
    if (!$pdo) {
        $c = cfg('db');
        $pdo = new PDO("mysql:host={$c['host']};dbname={$c['name']};charset=utf8mb4", $c['user'], $c['pass'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
        $pdo->exec("SET time_zone = '+00:00'"); // tudo em UTC no banco
    }
    return $pdo;
}

// ---------- entrada ----------
function method() { return $_SERVER['REQUEST_METHOD'] ?? 'GET'; }
// POST + cabeçalho customizado = proteção CSRF (navegador exige preflight cross-origin)
function require_post() {
    if (method() !== 'POST') fail('Use POST.', 405);
    if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'fetch') fail('Requisição inválida.', 403);
}
function input() {
    static $in = null;
    if ($in === null) {
        $in = [];
        $raw = file_get_contents('php://input');
        if ($raw) { $j = json_decode($raw, true); if (is_array($j)) $in = $j; }
        $in = array_merge($_GET, $in);
    }
    return $in;
}
function s($k, $max = 255) {
    $v = input()[$k] ?? '';
    return is_string($v) ? mb_substr(trim($v), 0, $max) : '';
}
function n($k, $d = 0) { $v = input()[$k] ?? $d; return is_numeric($v) ? (int)$v : $d; }
function b($k) { return filter_var(input()[$k] ?? false, FILTER_VALIDATE_BOOLEAN); }
function like_escape($v) { return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $v); }

// ---------- usuário ----------
function user_by_id($id) {
    $st = db()->prepare('SELECT * FROM users WHERE id = ?');
    $st->execute([$id]);
    return $st->fetch() ?: null;
}
function current_user($required = true) {
    $u = empty($_SESSION['uid']) ? null : user_by_id((int)$_SESSION['uid']);
    if (!$u) {
        if ($required) fail('Não autenticado.', 401);
        return null;
    }
    db()->prepare('UPDATE users SET last_seen_at = UTC_TIMESTAMP()
                   WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < UTC_TIMESTAMP() - INTERVAL 30 SECOND)')
        ->execute([$u['id']]);
    return $u;
}
function public_user(array $u) {
    return [
        'id' => (int)$u['id'], 'username' => $u['username'], 'display_name' => $u['display_name'],
        'email' => $u['email'], 'avatar_url' => $u['avatar_url'],
        'pomodoro_title' => $u['pomodoro_title'], 'theme' => $u['theme'],
        'focus_minutes' => (int)$u['focus_minutes'], 'break_minutes' => (int)$u['break_minutes'],
        'plan_type' => $u['plan_type'], 'has_pro' => $u['plan_type'] !== 'free',
        'is_admin' => (int)$u['is_admin'] === 1,
    ];
}
function login_session($uid) { session_regenerate_id(true); $_SESSION['uid'] = (int)$uid; }
function presence_of(array $row) {
    if (empty($row['last_seen_at']) || strtotime($row['last_seen_at'] . ' UTC') < time() - 90) return 'offline';
    return $row['presence_status'] === 'offline' ? 'online' : $row['presence_status'];
}
function create_user($email, $hash, $username, $display, $sub, $avatar) {
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $pdo->prepare('INSERT INTO users (google_sub, email, password_hash, username, display_name, avatar_url) VALUES (?,?,?,?,?,?)')
            ->execute([$sub, $email, $hash, $username, $display, $avatar]);
        $id = (int)$pdo->lastInsertId();
        $pdo->prepare('INSERT INTO streaks (user_id) VALUES (?)')->execute([$id]);
        $pdo->prepare('INSERT INTO subscriptions (user_id) VALUES (?)')->execute([$id]);
        $pdo->commit();
        return $id;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}
function are_friends($a, $b) {
    $st = db()->prepare("SELECT 1 FROM friendships WHERE status = 'accepted'
        AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)) LIMIT 1");
    $st->execute([$a, $b, $b, $a]);
    return (bool)$st->fetchColumn();
}

// ---------- ofensiva ----------
function local_tz() { return new DateTimeZone(cfg('app_tz', 'America/Sao_Paulo')); }
function local_date() { return (new DateTimeImmutable('now', local_tz()))->format('Y-m-d'); }

function streak_view(array $s, $todayStr, array $events = []) {
    $has = (int)$s['streak_freezes'] > 0;
    $rev = (int)$s['freeze_unlocked_revealed'] === 1;
    return [
        'current_streak' => (int)$s['current_streak'], 'longest_streak' => (int)$s['longest_streak'],
        'last_study_date' => $s['last_study_date'], 'daily_goal_minutes' => (int)$s['daily_goal_minutes'],
        'today_focused_minutes' => (int)$s['today_focused_minutes'],
        'goal_met_today' => $s['last_study_date'] === $todayStr,
        // bloqueio oculto: a contagem só aparece depois da revelação
        'freeze_reveal_pending' => $has && !$rev,
        'streak_freezes' => $rev ? (int)$s['streak_freezes'] : null,
        'events' => $events, // 'freeze_used' | 'streak_lost'
    ];
}

/** Recalcula a ofensiva (quebra/bloqueio), os minutos de hoje e conta o dia se a meta foi batida. */
function streak_refresh($uid) {
    $pdo = db(); $ev = [];
    $tz = local_tz();
    $today = (new DateTimeImmutable('now', $tz))->setTime(0, 0, 0);
    $todayStr = $today->format('Y-m-d');
    $pdo->beginTransaction();
    try {
        $pdo->prepare('INSERT IGNORE INTO streaks (user_id) VALUES (?)')->execute([$uid]);
        $st = $pdo->prepare('SELECT * FROM streaks WHERE user_id = ? FOR UPDATE');
        $st->execute([$uid]);
        $s = $st->fetch();
        $cur = (int)$s['current_streak']; $longest = (int)$s['longest_streak'];
        $last = $s['last_study_date']; $fr = (int)$s['streak_freezes']; $rev = (int)$s['freeze_unlocked_revealed'];

        if ($last && $cur > 0) {
            $missed = (int)(new DateTimeImmutable($last . ' 00:00:00', $tz))->diff($today)->days - 1;
            if ($missed >= 1) {
                if ($missed === 1 && $fr >= 1) {          // bloqueio cobre 1 dia perdido
                    $fr--; $rev = 1;
                    $last = $today->modify('-1 day')->format('Y-m-d');
                    $ev[] = 'freeze_used';
                } else {
                    $cur = 0; $ev[] = 'streak_lost';
                }
            }
        }

        $utc = new DateTimeZone('UTC');
        $q = $pdo->prepare('SELECT COALESCE(SUM(duration_minutes), 0) FROM focus_logs
                            WHERE user_id = ? AND completed_at >= ? AND completed_at < ?');
        $q->execute([$uid, $today->setTimezone($utc)->format('Y-m-d H:i:s'),
                     $today->modify('+1 day')->setTimezone($utc)->format('Y-m-d H:i:s')]);
        $mins = min(65535, (int)$q->fetchColumn());

        if ($mins >= (int)$s['daily_goal_minutes'] && $last !== $todayStr) {
            $cur++; $longest = max($longest, $cur); $last = $todayStr;
            if ($cur % 5 === 0 && $fr < 1) { $fr = 1; $rev = 0; } // bloqueio surpresa a cada 5 dias (máx. 1)
        }

        $pdo->prepare('UPDATE streaks SET current_streak=?, longest_streak=?, last_study_date=?, streak_freezes=?,
                       freeze_unlocked_revealed=?, today_focused_minutes=? WHERE user_id=?')
            ->execute([$cur, $longest, $last, $fr, $rev, $mins, $uid]);
        $pdo->commit();
        return streak_view(array_merge($s, [
            'current_streak' => $cur, 'longest_streak' => $longest, 'last_study_date' => $last,
            'streak_freezes' => $fr, 'freeze_unlocked_revealed' => $rev, 'today_focused_minutes' => $mins,
        ]), $todayStr, $ev);
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

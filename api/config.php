<?php
// Copie/edite para cada ambiente (XAMPP local x InfinityFree).
return [
    'debug'            => true,                 // false em produção
    'app_tz'           => 'America/Sao_Paulo',  // fuso usado para "dia" da ofensiva
    'google_client_id' => 'SEU_CLIENT_ID.apps.googleusercontent.com',
    'db' => [
        'host' => 'localhost',   // InfinityFree: algo como sqlXXX.infinityfree.com
        'name' => 'pomodoro_db', // InfinityFree: if0_XXXXXXX_pomodoro_db
        'user' => 'root',
        'pass' => '',
    ],
];

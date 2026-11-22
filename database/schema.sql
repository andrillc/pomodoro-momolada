CREATE DATABASE IF NOT EXISTS pomodoro_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE pomodoro_db;

CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  google_sub VARCHAR(255) NULL UNIQUE,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NULL,
  username VARCHAR(40) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  avatar_url VARCHAR(255) NULL,
  pomodoro_title VARCHAR(100) NOT NULL DEFAULT 'Pomodoro',
  theme VARCHAR(40) NOT NULL DEFAULT 'default',
  focus_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 25,
  break_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 5,
  plan_type ENUM('free', 'pro', 'vip_manual') NOT NULL DEFAULT 'free',
  is_admin TINYINT(1) NOT NULL DEFAULT 0,
  presence_status ENUM('offline', 'online', 'focusing', 'break') NOT NULL DEFAULT 'offline',
  last_seen_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE tasks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  priority ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'low',
  is_completed TINYINT(1) NOT NULL DEFAULT 0,
  position INT UNSIGNED NOT NULL DEFAULT 0,
  subject_tag VARCHAR(60) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tasks_user_order (user_id, position),
  CONSTRAINT fk_tasks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE friendships (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  requester_id BIGINT UNSIGNED NOT NULL,
  addressee_id BIGINT UNSIGNED NOT NULL,
  status ENUM('pending', 'accepted', 'rejected') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_friendship_pair (requester_id, addressee_id),
  INDEX idx_friendships_addressee (addressee_id, status),
  CONSTRAINT fk_friend_requester FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_friend_addressee FOREIGN KEY (addressee_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_not_self_friend CHECK (requester_id <> addressee_id)
) ENGINE=InnoDB;

CREATE TABLE streaks (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  current_streak INT UNSIGNED NOT NULL DEFAULT 0,
  longest_streak INT UNSIGNED NOT NULL DEFAULT 0,
  last_study_date DATE NULL,
  daily_goal_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 25,
  today_focused_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  streak_freezes TINYINT UNSIGNED NOT NULL DEFAULT 0,
  freeze_unlocked_revealed TINYINT(1) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_streaks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE streak_boosts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sender_id BIGINT UNSIGNED NOT NULL,
  receiver_id BIGINT UNSIGNED NOT NULL,
  boost_date DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_boost_daily (sender_id, receiver_id, boost_date),
  CONSTRAINT fk_boost_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_boost_receiver FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE study_rooms (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  host_id BIGINT UNSIGNED NOT NULL,
  mode ENUM('synced', 'independent') NOT NULL DEFAULT 'synced',
  timer_state ENUM('idle', 'running', 'paused') NOT NULL DEFAULT 'idle',
  timer_phase ENUM('focus', 'break') NOT NULL DEFAULT 'focus',
  phase_end_at DATETIME NULL,
  remaining_seconds INT UNSIGNED NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_room_host FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE room_participants (
  room_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  invite_status ENUM('invited', 'joined', 'declined', 'left') NOT NULL DEFAULT 'invited',
  joined_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (room_id, user_id),
  INDEX idx_room_user_status (user_id, invite_status),
  CONSTRAINT fk_rp_room FOREIGN KEY (room_id) REFERENCES study_rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_rp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE focus_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  duration_minutes SMALLINT UNSIGNED NOT NULL,
  subject_tag VARCHAR(60) NULL,
  room_id BIGINT UNSIGNED NULL,
  completed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_focus_logs_user_date (user_id, completed_at),
  CONSTRAINT fk_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_logs_room FOREIGN KEY (room_id) REFERENCES study_rooms(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE subscriptions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL UNIQUE,
  plan ENUM('free', 'pro') NOT NULL DEFAULT 'free',
  source ENUM('none', 'mercadopago', 'stripe', 'manual_admin') NOT NULL DEFAULT 'none',
  granted_by BIGINT UNSIGNED NULL,
  notes VARCHAR(255) NULL,
  status ENUM('active', 'canceled', 'expired') NOT NULL DEFAULT 'active',
  current_period_end DATETIME NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sub_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_sub_admin FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

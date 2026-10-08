-- SecureCheck Database Migration Script

CREATE DATABASE IF NOT EXISTS securecheck_db;
USE securecheck_db;

-- 1. Users Table
-- Stores user-specific settings and state.
-- Privacy: Email is stored for delivery but tied to an anonymous_id for logic.
CREATE TABLE IF NOT EXISTS users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    anonymous_id CHAR(64) NOT NULL UNIQUE,
    lang VARCHAR(5) DEFAULT 'en',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_breach_count INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    last_checked TIMESTAMP NULL,
    INDEX idx_anonymous_id (anonymous_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Subscriptions Table
-- Links users to their frequency preferences.
CREATE TABLE IF NOT EXISTS subscriptions (
    sub_id CHAR(64) PRIMARY KEY, -- Unique subscription identifier
    user_id INT NOT NULL,
    frequency ENUM('daily', 'weekly', 'monthly') NOT NULL,
    status ENUM('active', 'inactive') DEFAULT 'active',
    lang VARCHAR(5) DEFAULT 'en',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Breach Checks Table
-- Logs checks performed. IP is hashed for privacy.
CREATE TABLE IF NOT EXISTS breach_checks (
    check_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL, -- NULL if not subscribed
    check_type ENUM('email', 'password') NOT NULL,
    risk_level ENUM('safe', 'yellow', 'red') DEFAULT 'safe',
    breach_count INT DEFAULT 0,
    checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_hash CHAR(64) NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Breach Records Table
-- Stores details of individual breaches found in a check.
CREATE TABLE IF NOT EXISTS breach_records (
    record_id INT AUTO_INCREMENT PRIMARY KEY,
    check_id INT NOT NULL,
    breach_title VARCHAR(255),
    breach_date DATE,
    data_classes JSON, -- List of exposed data types
    is_verified BOOLEAN DEFAULT TRUE,
    is_sensitive BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (check_id) REFERENCES breach_checks(check_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Reports Table
-- Metadata for generated and sent reports.
CREATE TABLE IF NOT EXISTS reports (
    report_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    format ENUM('PDF', 'HTML') DEFAULT 'PDF',
    lang VARCHAR(5) DEFAULT 'en',
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status ENUM('sent', 'failed') DEFAULT 'sent',
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

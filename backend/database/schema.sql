-- SecureCheck Professional PostgreSQL Schema
-- Designed for High Privacy and Security

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Subscription Plans
CREATE TABLE subscription_plans (
    plan_id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    price_cents INT NOT NULL DEFAULT 0,
    check_limit_monthly INT NOT NULL,
    features JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO subscription_plans (name, price_cents, check_limit_monthly, features) VALUES 
('Free', 0, 5, '{"reports": false, "auto_scan": false}'),
('Pro', 999, 100, '{"reports": true, "auto_scan": true}');

-- 2. Users (Core Privacy Table)
-- We store the raw email encrypted for notification delivery ONLY.
-- The anonymous_id is the primary lookup for breach logic.
CREATE TABLE users (
    user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    anonymous_id CHAR(64) UNIQUE NOT NULL, -- SHA-256(email + salt)
    encrypted_email TEXT NOT NULL,         -- AES-256-GCM encrypted email
    email_iv CHAR(24) NOT NULL,           -- Initialization Vector for encryption
    lang VARCHAR(5) DEFAULT 'en',
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_anon_id ON users(anonymous_id);

-- 3. Subscriptions
CREATE TABLE subscriptions (
    sub_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    plan_id INT NOT NULL REFERENCES subscription_plans(plan_id),
    frequency VARCHAR(20) CHECK (frequency IN ('daily', 'weekly', 'monthly')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'paused')),
    next_check_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Scan Sessions (History)
-- anonymized_ip is SHA-256(IP + daily_salt)
CREATE TABLE scan_sessions (
    session_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NULL REFERENCES users(user_id) ON DELETE SET NULL, -- NULL if one-time check
    scan_type VARCHAR(20) NOT NULL CHECK (scan_type IN ('email', 'password')),
    risk_score INT DEFAULT 0,
    breach_count INT DEFAULT 0,
    anonymized_ip CHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Breach Records (Persistent Details for Subscribed Users)
CREATE TABLE breach_details (
    record_id SERIAL PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES scan_sessions(session_id) ON DELETE CASCADE,
    external_breach_id VARCHAR(100), -- ID from HIBP or other provider
    title VARCHAR(255),
    breach_date DATE,
    data_classes JSONB,
    is_verified BOOLEAN DEFAULT TRUE,
    is_sensitive BOOLEAN DEFAULT FALSE
);

-- 6. Security Recommendations
CREATE TABLE recommendations (
    rec_id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    priority VARCHAR(10) CHECK (priority IN ('low', 'medium', 'high')),
    category VARCHAR(50), -- e.g., 'password_hygiene', 'mfa', 'leak_response'
    message_en TEXT NOT NULL,
    message_ar TEXT NOT NULL,
    is_resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Audit & System Logs
CREATE TABLE system_audit_log (
    log_id BIGSERIAL PRIMARY KEY,
    action VARCHAR(100) NOT NULL,
    actor_id UUID NULL, -- user_id if applicable
    severity VARCHAR(20) DEFAULT 'info',
    metadata JSONB, -- No sensitive data allowed here
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Notifications
CREATE TABLE notifications (
    notif_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    sent_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT
);

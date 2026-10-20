CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    user_query TEXT NOT NULL,
    bot_response TEXT NOT NULL,
    category TEXT DEFAULT 'عام',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

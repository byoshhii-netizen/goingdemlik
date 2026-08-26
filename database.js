const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PGPOOL_MAX || 10),
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : false,
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      avatar TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      links TEXT DEFAULT '[]',
      level_id INTEGER DEFAULT 1,
      show_level_badge INTEGER DEFAULT 1,
      show_level_progress INTEGER DEFAULT 1,
      show_level_color INTEGER DEFAULT 1,
      is_vip INTEGER DEFAULT 0,
      is_plus INTEGER DEFAULT 0,
      name_color TEXT DEFAULT '',
      banned INTEGER DEFAULT 0,
      ban_type TEXT DEFAULT '',
      banned_ip TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      kvkk_accepted INTEGER DEFAULT 0,
      forum_count INTEGER DEFAULT 0,
      book_count INTEGER DEFAULT 0,
      comment_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      last_active TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_private INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS show_level_progress INTEGER DEFAULT 1;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS tag_permission TEXT DEFAULT 'everyone';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS homepage_sections TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_visibility TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_removed INTEGER DEFAULT 0;
    UPDATE users SET tag_permission='everyone' WHERE tag_permission IS NULL OR tag_permission='';

    CREATE TABLE IF NOT EXISTS follows (
      id BIGSERIAL PRIMARY KEY,
      follower_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      following_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'accepted',
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(follower_id, following_id),
      CHECK (follower_id <> following_id)
    );
    CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
    CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);

    CREATE TABLE IF NOT EXISTS stories (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      public_id TEXT UNIQUE,
      media_url TEXT NOT NULL,
      media_type TEXT NOT NULL DEFAULT 'image',
      caption TEXT DEFAULT '',
      song_id BIGINT,
      song_start_seconds INTEGER DEFAULT 0,
      duration_hours INTEGER NOT NULL DEFAULT 24,
      is_suspended INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
    );
    ALTER TABLE stories ADD COLUMN IF NOT EXISTS song_id BIGINT;
    ALTER TABLE stories ADD COLUMN IF NOT EXISTS song_start_seconds INTEGER DEFAULT 0;
    ALTER TABLE stories ADD COLUMN IF NOT EXISTS duration_hours INTEGER NOT NULL DEFAULT 24;
    ALTER TABLE stories ADD COLUMN IF NOT EXISTS public_id TEXT;
    ALTER TABLE stories ADD COLUMN IF NOT EXISTS is_suspended INTEGER NOT NULL DEFAULT 0;
    UPDATE stories SET public_id='h' || substr(md5(random()::text || id::text), 1, 10) WHERE public_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stories_public_id ON stories(public_id);
    CREATE INDEX IF NOT EXISTS idx_stories_active ON stories(expires_at, user_id);

    CREATE TABLE IF NOT EXISTS story_views (
      id BIGSERIAL PRIMARY KEY,
      story_id BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      viewer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      view_count INTEGER NOT NULL DEFAULT 1,
      viewed_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(story_id, viewer_id)
    );
    ALTER TABLE story_views ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 1;

    CREATE TABLE IF NOT EXISTS story_likes (
      id BIGSERIAL PRIMARY KEY,
      story_id BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(story_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS story_replies (
      id BIGSERIAL PRIMARY KEY,
      story_id BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
    );
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
    UPDATE sessions SET expires_at=created_at + INTERVAL '30 days' WHERE expires_at IS NULL;
    ALTER TABLE sessions ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '30 days');
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '8 hours')
    );

    CREATE TABLE IF NOT EXISTS levels (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT DEFAULT 'fas fa-star',
      color TEXT DEFAULT '#dc2626',
      min_forums INTEGER DEFAULT 0,
      min_books INTEGER DEFAULT 0,
      min_comments INTEGER DEFAULT 0,
      min_book_pages INTEGER DEFAULT 0,
      require_any INTEGER DEFAULT 0,
      order_num INTEGER DEFAULT 0,
      daily_forums INTEGER DEFAULT -1,
      daily_books INTEGER DEFAULT -1,
      daily_book_pages INTEGER DEFAULT -1,
      daily_forums_vip INTEGER DEFAULT -1,
      daily_books_vip INTEGER DEFAULT -1,
      daily_book_pages_vip INTEGER DEFAULT -1,
      daily_forums_plus INTEGER DEFAULT -1,
      daily_books_plus INTEGER DEFAULT -1,
      daily_book_pages_plus INTEGER DEFAULT -1
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    INSERT INTO settings (key, value) VALUES
      ('route_protection_enabled', '0'),
      ('protected_routes', '["/admin","/yonetim","/yonetici","/yonet"]'),
      ('route_redirect', '/')
    ON CONFLICT (key) DO NOTHING;
    UPDATE settings SET value='#121212' WHERE key='background_color' AND value='#2596be';

    CREATE TABLE IF NOT EXISTS forums (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      banner_image TEXT DEFAULT '',
      slug TEXT UNIQUE,
      allow_comments INTEGER DEFAULT 1,
      custom_tags TEXT DEFAULT '',
      views INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS forum_views (
      id BIGSERIAL PRIMARY KEY,
      forum_id BIGINT,
      ip TEXT,
      view_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS forum_likes (
      id BIGSERIAL PRIMARY KEY,
      forum_id BIGINT,
      user_id BIGINT,
      UNIQUE(forum_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS forum_comments (
      id BIGSERIAL PRIMARY KEY,
      forum_id BIGINT,
      user_id BIGINT,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY(forum_id) REFERENCES forums(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS forum_comment_likes (
      id BIGSERIAL PRIMARY KEY,
      comment_id BIGINT,
      user_id BIGINT,
      UNIQUE(comment_id, user_id),
      FOREIGN KEY(comment_id) REFERENCES forum_comments(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tags (
      id BIGSERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      color TEXT DEFAULT '#dc2626',
      is_system INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS forum_tags (
      id BIGSERIAL PRIMARY KEY,
      forum_id BIGINT,
      tag_id BIGINT,
      UNIQUE(forum_id, tag_id),
      FOREIGN KEY(forum_id) REFERENCES forums(id) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS books (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT,
      title TEXT NOT NULL,
      preface TEXT DEFAULT '',
      karakterler TEXT DEFAULT '',
      kadro TEXT DEFAULT '',
      cover_image TEXT DEFAULT '',
      slug TEXT UNIQUE,
      page_count INTEGER DEFAULT 0,
      is_hidden INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    ALTER TABLE books ADD COLUMN IF NOT EXISTS karakterler TEXT DEFAULT '';
    ALTER TABLE books ADD COLUMN IF NOT EXISTS kadro TEXT DEFAULT '';
    ALTER TABLE books ADD COLUMN IF NOT EXISTS is_hidden INTEGER DEFAULT 0;
    ALTER TABLE books ADD COLUMN IF NOT EXISTS allow_download INTEGER DEFAULT 1;
    ALTER TABLE books ADD COLUMN IF NOT EXISTS allow_pdf INTEGER DEFAULT 1;
    ALTER TABLE books ADD COLUMN IF NOT EXISTS is_unnamed INTEGER DEFAULT 0;

    CREATE TABLE IF NOT EXISTS book_chapters (
      id BIGSERIAL PRIMARY KEY,
      book_id BIGINT,
      title TEXT NOT NULL,
      order_num INTEGER DEFAULT 0,
      FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS book_pages (
      id BIGSERIAL PRIMARY KEY,
      book_id BIGINT,
      chapter_id BIGINT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      page_num INTEGER DEFAULT 1,
      slug TEXT UNIQUE,
      image_url TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE,
      FOREIGN KEY(chapter_id) REFERENCES book_chapters(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS groups (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE,
      description TEXT DEFAULT '',
      cover_image TEXT DEFAULT '',
      owner_id BIGINT,
      type TEXT DEFAULT 'public',
      allow_chat INTEGER DEFAULT 1,
      allow_photos INTEGER DEFAULT 1,
      invite_only INTEGER DEFAULT 0,
      member_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS group_members (
      id BIGSERIAL PRIMARY KEY,
      group_id BIGINT,
      user_id BIGINT,
      role TEXT DEFAULT 'member',
      joined_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(group_id, user_id),
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS group_join_requests (
      id BIGSERIAL PRIMARY KEY,
      group_id BIGINT,
      user_id BIGINT,
      status TEXT DEFAULT 'pending',
      rejection_reason TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      reviewed_at TIMESTAMP,
      reviewed_by BIGINT,
      UNIQUE(group_id, user_id),
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(reviewed_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS moderator_permissions (
      id BIGSERIAL PRIMARY KEY,
      group_id BIGINT,
      user_id BIGINT,
      can_delete_messages INTEGER DEFAULT 0,
      can_ban_members INTEGER DEFAULT 0,
      can_edit_group INTEGER DEFAULT 0,
      can_manage_invites INTEGER DEFAULT 0,
      UNIQUE(group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS group_messages (
      id BIGSERIAL PRIMARY KEY,
      group_id BIGINT,
      user_id BIGINT,
      content TEXT,
      image_url TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS group_invites (
      id BIGSERIAL PRIMARY KEY,
      group_id BIGINT,
      invite_code TEXT UNIQUE,
      created_by BIGINT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS photos (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      url TEXT NOT NULL,
      public_id TEXT DEFAULT '',
      caption TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
      CREATE TABLE IF NOT EXISTS photo_likes (
        id BIGSERIAL PRIMARY KEY,
        photo_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(photo_id, user_id),
        FOREIGN KEY(photo_id) REFERENCES photos(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS photo_comments (
        id BIGSERIAL PRIMARY KEY,
        photo_id BIGINT NOT NULL,
        user_id BIGINT,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY(photo_id) REFERENCES photos(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS badges (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT DEFAULT '',
        color TEXT DEFAULT '#6b7280',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS gifts (
        id BIGSERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        sender_id BIGINT NOT NULL,
        recipient_id BIGINT,
        recipient_username TEXT DEFAULT '',
        type TEXT NOT NULL,
        redeemed INTEGER DEFAULT 0,
        redeemed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(recipient_id) REFERENCES users(id) ON DELETE SET NULL
      );

    CREATE TABLE IF NOT EXISTS system_logs (
      id BIGSERIAL PRIMARY KEY,
      actor TEXT,
      action TEXT,
      target TEXT DEFAULT '',
      detail TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      device TEXT DEFAULT '',
      operating_system TEXT DEFAULT '',
      country TEXT DEFAULT '',
      city TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    );
    ALTER TABLE system_logs ADD COLUMN IF NOT EXISTS user_agent TEXT DEFAULT '';
    ALTER TABLE system_logs ADD COLUMN IF NOT EXISTS device TEXT DEFAULT '';
    ALTER TABLE system_logs ADD COLUMN IF NOT EXISTS operating_system TEXT DEFAULT '';
    ALTER TABLE system_logs ADD COLUMN IF NOT EXISTS country TEXT DEFAULT '';
    ALTER TABLE system_logs ADD COLUMN IF NOT EXISTS city TEXT DEFAULT '';

    CREATE TABLE IF NOT EXISTS friendships (
      id BIGSERIAL PRIMARY KEY,
      requester_id BIGINT NOT NULL,
      addressee_id BIGINT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(requester_id, addressee_id),
      FOREIGN KEY(requester_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(addressee_id) REFERENCES users(id) ON DELETE CASCADE
    );
    INSERT INTO follows (follower_id, following_id, status)
    SELECT requester_id, addressee_id, 'accepted' FROM friendships WHERE status='accepted'
    ON CONFLICT (follower_id, following_id) DO UPDATE SET status='accepted';
    INSERT INTO follows (follower_id, following_id, status)
    SELECT addressee_id, requester_id, 'accepted' FROM friendships WHERE status='accepted'
    ON CONFLICT (follower_id, following_id) DO UPDATE SET status='accepted';

    CREATE TABLE IF NOT EXISTS blocks (
      id BIGSERIAL PRIMARY KEY,
      blocker_id BIGINT NOT NULL,
      blocked_id BIGINT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(blocker_id, blocked_id),
      FOREIGN KEY(blocker_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(blocked_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS dm_conversations (
      id BIGSERIAL PRIMARY KEY,
      user1_id BIGINT NOT NULL,
      user2_id BIGINT NOT NULL,
      hidden_by_user1 INTEGER DEFAULT 0,
      hidden_by_user2 INTEGER DEFAULT 0,
      hidden_pass_user1 TEXT DEFAULT '',
      hidden_pass_user2 TEXT DEFAULT '',
      last_message_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user1_id, user2_id),
      FOREIGN KEY(user1_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(user2_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS videos (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      video_url TEXT NOT NULL,
      thumbnail_url TEXT DEFAULT '',
      location TEXT DEFAULT '',
      sound_name TEXT DEFAULT '',
      allow_comments INTEGER DEFAULT 1,
      show_likes INTEGER DEFAULT 1,
      is_reals INTEGER DEFAULT 0,
      like_count INTEGER DEFAULT 0,
      comment_count INTEGER DEFAULT 0,
      slug TEXT UNIQUE,
      views INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    ALTER TABLE videos ADD COLUMN IF NOT EXISTS location TEXT DEFAULT '';
    ALTER TABLE videos ADD COLUMN IF NOT EXISTS sound_name TEXT DEFAULT '';
    ALTER TABLE videos ADD COLUMN IF NOT EXISTS allow_comments INTEGER DEFAULT 1;
    ALTER TABLE videos ADD COLUMN IF NOT EXISTS show_likes INTEGER DEFAULT 1;
    ALTER TABLE videos ADD COLUMN IF NOT EXISTS is_reals INTEGER DEFAULT 0;
    ALTER TABLE videos ADD COLUMN IF NOT EXISTS like_count INTEGER DEFAULT 0;
    ALTER TABLE videos ADD COLUMN IF NOT EXISTS comment_count INTEGER DEFAULT 0;

    CREATE TABLE IF NOT EXISTS video_likes (
      id BIGSERIAL PRIMARY KEY,
      video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(video_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS video_saves (
      id BIGSERIAL PRIMARY KEY,
      video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(video_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS video_comments (
      id BIGSERIAL PRIMARY KEY,
      video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS photo_comment_likes (
      id BIGSERIAL PRIMARY KEY,
      comment_id BIGINT NOT NULL REFERENCES photo_comments(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(comment_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS dm_messages (
      id BIGSERIAL PRIMARY KEY,
      conversation_id BIGINT NOT NULL,
      sender_id BIGINT NOT NULL,
      content TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      shared_forum_id BIGINT,
      shared_video_id BIGINT,
      shared_story_id BIGINT,
      reply_to_id BIGINT,
      deleted_by_sender INTEGER DEFAULT 0,
      deleted_by_receiver INTEGER DEFAULT 0,
      deleted_for_all INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY(conversation_id) REFERENCES dm_conversations(id) ON DELETE CASCADE,
      FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(shared_forum_id) REFERENCES forums(id) ON DELETE SET NULL,
      FOREIGN KEY(shared_video_id) REFERENCES videos(id) ON DELETE SET NULL,
      FOREIGN KEY(reply_to_id) REFERENCES dm_messages(id) ON DELETE SET NULL
    );

    ALTER TABLE forums ADD COLUMN IF NOT EXISTS allow_sharing INTEGER DEFAULT 1;
    ALTER TABLE forums ADD COLUMN IF NOT EXISTS share_count INTEGER DEFAULT 0;
    ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS shared_video_id BIGINT;
    ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS shared_photo_id BIGINT;
    ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS shared_story_id BIGINT;
    ALTER TABLE dm_conversations ADD COLUMN IF NOT EXISTS read_until_user1 BIGINT DEFAULT 0;
      ALTER TABLE photos ADD COLUMN IF NOT EXISTS show_likes INTEGER DEFAULT 1;
      ALTER TABLE photos ADD COLUMN IF NOT EXISTS allow_comments INTEGER DEFAULT 1;
      ALTER TABLE photos ADD COLUMN IF NOT EXISTS allow_shares INTEGER DEFAULT 1;
      ALTER TABLE photos ADD COLUMN IF NOT EXISTS like_count INTEGER DEFAULT 0;
      ALTER TABLE photos ADD COLUMN IF NOT EXISTS comment_count INTEGER DEFAULT 0;
      ALTER TABLE photos ADD COLUMN IF NOT EXISTS share_count INTEGER DEFAULT 0;
      ALTER TABLE photos ADD COLUMN IF NOT EXISTS public_id TEXT DEFAULT '';
    ALTER TABLE dm_conversations ADD COLUMN IF NOT EXISTS read_until_user2 BIGINT DEFAULT 0;
    CREATE TABLE IF NOT EXISTS voice_calls (
      id UUID PRIMARY KEY,
      caller_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      callee_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'ringing',
      offer JSONB,
      answer JSONB,
      caller_ice JSONB NOT NULL DEFAULT '[]'::jsonb,
      callee_ice JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      ended_at TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_voice_calls_callee ON voice_calls(callee_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_voice_calls_caller ON voice_calls(caller_id, status, created_at DESC);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_since TIMESTAMP;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS spotify_id TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS spotify_token TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS spotify_refresh TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS spotify_show INTEGER DEFAULT 1;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS spotify_expires BIGINT DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS title TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS location TEXT DEFAULT '';
    ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMP;
    CREATE INDEX IF NOT EXISTS idx_dm_messages_conversation_created ON dm_messages(conversation_id, created_at, id);

    CREATE TABLE IF NOT EXISTS announcements (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      bg_color TEXT DEFAULT '#dc2626',
      text_color TEXT DEFAULT '#ffffff',
      border_color TEXT DEFAULT '#991b1b',
      position TEXT DEFAULT 'top',
      size TEXT DEFAULT 'normal',
      expires_at TIMESTAMP,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS admin_permissions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT UNIQUE NOT NULL,
      can_ban_users INTEGER DEFAULT 0,
      can_delete_content INTEGER DEFAULT 0,
      can_edit_content INTEGER DEFAULT 0,
      can_manage_levels INTEGER DEFAULT 0,
      can_manage_tags INTEGER DEFAULT 0,
      can_manage_announcements INTEGER DEFAULT 0,
      can_view_logs INTEGER DEFAULT 0,
      can_manage_settings INTEGER DEFAULT 0,
      can_manage_admins INTEGER DEFAULT 0,
      can_view_users INTEGER DEFAULT 1,
      granted_by BIGINT,
      granted_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    ALTER TABLE settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
    ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_permissions_id BIGINT;
    ALTER TABLE admin_permissions ADD COLUMN IF NOT EXISTS can_suspend_content INTEGER DEFAULT 0;
    ALTER TABLE admin_permissions ADD COLUMN IF NOT EXISTS can_restrict_users INTEGER DEFAULT 0;
    ALTER TABLE admin_permissions ADD COLUMN IF NOT EXISTS can_review_artists INTEGER DEFAULT 0;
    ALTER TABLE admin_permissions ADD COLUMN IF NOT EXISTS can_assign_badges INTEGER DEFAULT 0;
    ALTER TABLE admin_permissions ADD COLUMN IF NOT EXISTS can_view_store INTEGER DEFAULT 0;
    ALTER TABLE admin_permissions ADD COLUMN IF NOT EXISTS can_view_groups INTEGER DEFAULT 0;
    ALTER TABLE admin_permissions ADD COLUMN IF NOT EXISTS can_view_stories INTEGER DEFAULT 0;
    ALTER TABLE admin_permissions ADD COLUMN IF NOT EXISTS can_view_reals INTEGER DEFAULT 0;
    ALTER TABLE admin_permissions ADD COLUMN IF NOT EXISTS can_view_levels INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_role TEXT DEFAULT '';
    CREATE TABLE IF NOT EXISTS user_restrictions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      restriction_type TEXT NOT NULL CHECK (restriction_type IN ('photo','story','reals','music','comment','forum','message','group')),
      reason TEXT NOT NULL,
      starts_at TIMESTAMP NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMP,
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      revoked_at TIMESTAMP,
      revoked_by BIGINT REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_restrictions_active ON user_restrictions(user_id, restriction_type, expires_at);
    CREATE TABLE IF NOT EXISTS content_suspensions (
      id BIGSERIAL PRIMARY KEY,
      content_type TEXT NOT NULL CHECK (content_type IN ('forum','book','photo','video','reals','story','song','group')),
      content_id BIGINT NOT NULL,
      reason TEXT NOT NULL,
      suspended_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(content_type, content_id)
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_artist INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS artist_since TIMESTAMP;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS artist_display_name TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS artist_bio TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS artist_genre TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS artist_website TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS badge_name TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS badge_icon TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS badge_color TEXT DEFAULT '#6b7280';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS badge_display TEXT DEFAULT 'level';
    ALTER TABLE songs ADD COLUMN IF NOT EXISTS ban_reason TEXT DEFAULT '';
    ALTER TABLE songs ADD COLUMN IF NOT EXISTS ban_until TIMESTAMP;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS delete_requested_at TIMESTAMP;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_deleted INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS allow_mentions INTEGER DEFAULT 1;
    ALTER TABLE forums ADD COLUMN IF NOT EXISTS banner_fit TEXT DEFAULT 'cover';
    ALTER TABLE forums ADD COLUMN IF NOT EXISTS images TEXT DEFAULT '[]';
    ALTER TABLE forums ADD COLUMN IF NOT EXISTS thumbnail TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS name_color_mode TEXT DEFAULT 'solid';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS name_gradient TEXT DEFAULT '';
    ALTER TABLE photos ADD COLUMN IF NOT EXISTS title TEXT DEFAULT '';
    ALTER TABLE photos ADD COLUMN IF NOT EXISTS location TEXT DEFAULT '';
    ALTER TABLE photos ADD COLUMN IF NOT EXISTS song_id BIGINT;
    ALTER TABLE photos ADD COLUMN IF NOT EXISTS song_start_seconds INTEGER DEFAULT 0;

    CREATE TABLE IF NOT EXISTS photo_ads (
      id BIGSERIAL PRIMARY KEY,
      portal_code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      site_url TEXT NOT NULL,
      image_url TEXT NOT NULL,
      show_likes INTEGER DEFAULT 1,
      allow_comments INTEGER DEFAULT 1,
      allow_shares INTEGER DEFAULT 1,
      active INTEGER DEFAULT 1,
      priority INTEGER DEFAULT 0,
      click_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ad_submissions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      type TEXT NOT NULL CHECK (type IN ('music','photo')),
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      site_url TEXT DEFAULT '',
      media_url TEXT NOT NULL,
      cover_url TEXT DEFAULT '',
      show_likes INTEGER DEFAULT 1,
      allow_comments INTEGER DEFAULT 1,
      allow_shares INTEGER DEFAULT 1,
      status TEXT DEFAULT 'pending',
      portal_code TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      type TEXT NOT NULL,
      actor_username TEXT DEFAULT '',
      actor_avatar TEXT DEFAULT '',
      title TEXT DEFAULT '',
      body TEXT DEFAULT '',
      link TEXT DEFAULT '',
      is_read INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS store_products (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      features TEXT DEFAULT '[]',
      type TEXT NOT NULL,
      price NUMERIC(10,2) NOT NULL DEFAULT 0,
      original_price NUMERIC(10,2) DEFAULT NULL,
      duration_days INTEGER NOT NULL DEFAULT 30,
      visible INTEGER NOT NULL DEFAULT 1,
      badge_color TEXT DEFAULT '#fbbf24',
      badge_icon TEXT DEFAULT 'fas fa-gem',
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id BIGINT REFERENCES store_products(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      started_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL,
      is_active INTEGER DEFAULT 1,
      order_id BIGINT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS store_orders (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id BIGINT REFERENCES store_products(id) ON DELETE SET NULL,
      product_name TEXT NOT NULL,
      product_type TEXT NOT NULL,
      amount NUMERIC(10,2) NOT NULL,
      currency TEXT DEFAULT 'TRY',
      status TEXT NOT NULL DEFAULT 'pending',
      shopier_order_id TEXT DEFAULT '',
      platform_order_id TEXT UNIQUE NOT NULL,
      payment_data TEXT DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Varsayılan mağaza ürünleri (sadece yoksa ekle)
    INSERT INTO store_products (name, description, features, type, price, original_price, duration_days, visible, badge_color, badge_icon, sort_order)
    SELECT * FROM (VALUES
      (
        'VIP Üyelik',
        '30 günlük VIP üyelik. Özel rozet, öncelikli destek ve daha fazlası.',
        '["Özel VIP rozeti","Öncelikli destek","VIP üye kanallarına erişim","Özel profil çerçevesi"]',
        'vip',
        49.99::NUMERIC,
        NULL::NUMERIC,
        30,
        1,
        '#f59e0b',
        'fas fa-star',
        1
      ),
      (
        'Plus Üyelik',
        '30 günlük Plus üyelik. Gelişmiş özellikler ve ayrıcalıklar.',
        '["Özel Plus rozeti","Reklamsız deneyim","Plus üye ayrıcalıkları","Özel profil teması"]',
        'plus',
        29.99::NUMERIC,
        NULL::NUMERIC,
        30,
        1,
        '#8b5cf6',
        'fas fa-gem',
        2
      ),
      (
        'Admin Üyelik',
        '30 günlük yönetici erişimi. Tüm yönetim araçlarına tam erişim.',
        '["Tam yönetici erişimi","Tüm üye özelliklerini içerir","Gelişmiş moderasyon araçları","Özel Admin rozeti"]',
        'admin',
        99.99::NUMERIC,
        NULL::NUMERIC,
        30,
        1,
        '#ef4444',
        'fas fa-shield-alt',
        3
      )
    ) AS v(name, description, features, type, price, original_price, duration_days, visible, badge_color, badge_icon, sort_order)
    WHERE NOT EXISTS (SELECT 1 FROM store_products LIMIT 1);



    INSERT INTO store_products (name, description, features, type, price, duration_days, visible, badge_color, badge_icon, sort_order)
    SELECT 'Müzik Reklamı Boost', 'Ses reklamını reklam havuzunda öne çıkarır.', '["Reklam havuzunda öncelik","Daha fazla gösterim"]', 'ad_boost', 39.99, 30, 1, '#dc2626', 'fas fa-bolt', 4
    WHERE NOT EXISTS (SELECT 1 FROM store_products WHERE type='ad_boost');

    CREATE TABLE IF NOT EXISTS artist_applications (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      genre TEXT NOT NULL,
      sample_song_url TEXT NOT NULL,
      sample_song_file TEXT DEFAULT '',
      note TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      reviewed_by BIGINT,
      reviewed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS songs (
      id BIGSERIAL PRIMARY KEY,
      uploader_id BIGINT NOT NULL,
      song_type TEXT NOT NULL DEFAULT 'own',
      title TEXT NOT NULL,
      artist_name TEXT NOT NULL,
      distributor TEXT DEFAULT '',
      genre TEXT DEFAULT '',
      lyrics TEXT DEFAULT '',
      cover_url TEXT DEFAULT '',
      audio_url TEXT NOT NULL,
      share_reason TEXT DEFAULT '',
      play_count INTEGER DEFAULT 0,
      slug TEXT UNIQUE,
      status TEXT DEFAULT 'active',
      published_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY(uploader_id) REFERENCES users(id) ON DELETE SET NULL
    );

    -- Müzik içi ses reklamları ve kullanıcı başına zorunlu reklam durumu
    CREATE TABLE IF NOT EXISTS music_ads (
      id BIGSERIAL PRIMARY KEY,
      portal_code CHAR(6) UNIQUE NOT NULL,
      title TEXT NOT NULL,
      site_url TEXT DEFAULT '',
      audio_url TEXT NOT NULL,
      cover_url TEXT DEFAULT '',
      priority INTEGER DEFAULT 0,
      boost_points INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      play_count INTEGER DEFAULT 0,
      click_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS music_ad_states (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      completed_song_count INTEGER DEFAULT 0,
      pending_ad_id BIGINT REFERENCES music_ads(id) ON DELETE SET NULL,
      ad_started_at TIMESTAMP,
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      public_id TEXT UNIQUE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      emoji TEXT DEFAULT '🎵',
      cover_url TEXT DEFAULT '',
      is_public INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS playlist_songs (
      id BIGSERIAL PRIMARY KEY,
      playlist_id BIGINT NOT NULL,
      song_id BIGINT NOT NULL,
      position INTEGER DEFAULT 0,
      added_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE,
      UNIQUE(playlist_id, song_id)
    );
    ALTER TABLE playlists ADD COLUMN IF NOT EXISTS public_id TEXT;
    ALTER TABLE playlists ADD COLUMN IF NOT EXISTS emoji TEXT DEFAULT '🎵';
    ALTER TABLE playlists ADD COLUMN IF NOT EXISTS cover_url TEXT DEFAULT '';
    ALTER TABLE playlists ADD COLUMN IF NOT EXISTS is_public INTEGER DEFAULT 1;
    CREATE UNIQUE INDEX IF NOT EXISTS playlists_public_id_unique ON playlists(public_id) WHERE public_id IS NOT NULL;
  `);

  // Seed default levels
  const { rows: lvRows } = await query('SELECT COUNT(*) as c FROM levels');
  if (parseInt(lvRows[0].c) === 0) {
    const ins = 'INSERT INTO levels (name,icon,color,min_forums,min_books,min_comments,order_num) VALUES ($1,$2,$3,$4,$5,$6,$7)';
    await query(ins, ['Yeni Üye',   'fas fa-seedling', '#6b7280', 0,  0,  0,   1]);
    await query(ins, ['Aktif Üye',  'fas fa-fire',     '#f97316', 5,  1,  10,  2]);
    await query(ins, ['Katkıcı',    'fas fa-pen',      '#3b82f6', 15, 3,  30,  3]);
    await query(ins, ['Uzman',      'fas fa-crown',    '#8b5cf6', 30, 5,  60,  4]);
    await query(ins, ['Efsane',     'fas fa-dragon',   '#dc2626', 50, 10, 100, 5]);
  }

  // Seed default tags
  const { rows: tagRows } = await query('SELECT COUNT(*) as c FROM tags');
  if (parseInt(tagRows[0].c) === 0) {
    const ins = 'INSERT INTO tags (name,color,is_system) VALUES ($1,$2,1)';
    await query(ins, ['Genel',     '#3b82f6']);
    await query(ins, ['Soru',      '#f97316']);
    await query(ins, ['Tartışma',  '#8b5cf6']);
    await query(ins, ['Haber',     '#dc2626']);
    await query(ins, ['Yardım',    '#10b981']);
    await query(ins, ['Teknoloji', '#06b6d4']);
    await query(ins, ['Sanat',     '#ec4899']);
    await query(ins, ['Edebiyat',  '#6366f1']);
  }

  // Seed admin password
  await query("INSERT INTO settings (key,value) VALUES ('admin_username','Tarator') ON CONFLICT (key) DO NOTHING");
  const { rows: pwRows } = await query("SELECT value FROM settings WHERE key='admin_password'");
  if (pwRows.length === 0) {
    const hash = crypto.createHash('sha256').update('admin123').digest('hex');
    await query('INSERT INTO settings (key,value) VALUES ($1,$2)', ['admin_password', hash]);
  }

  // Seed KVKK
  const { rows: kvkkRows } = await query("SELECT value FROM settings WHERE key='kvkk_text'");
  if (kvkkRows.length === 0) {
    await query('INSERT INTO settings (key,value) VALUES ($1,$2)', ['kvkk_text', `KİŞİSEL VERİLERİN KORUNMASI KANUNU (KVKK) AYDINLATMA METNİ

TeaTube olarak, 6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında kişisel verilerinizin işlenmesine ilişkin sizi bilgilendirmek isteriz.

1. VERİ SORUMLUSU
TeaTube platformu, veri sorumlusu sıfatıyla hareket etmektedir.

2. İŞLENEN KİŞİSEL VERİLER
Kullanıcı adı, e-posta adresi, IP adresi, platform içi içerikleriniz (forum gönderileri, kitap sayfaları, grup mesajları) işlenmektedir.

3. KİŞİSEL VERİLERİN İŞLENME AMACI
Kişisel verileriniz; platform hizmetlerinin sunulması, hesap yönetimi, güvenlik ve sahteciliğin önlenmesi amacıyla işlenmektedir.

4. KİŞİSEL VERİLERİN AKTARILMASI
Kişisel verileriniz yasal yükümlülükler dışında üçüncü kişilerle paylaşılmamaktadır.

5. HAKLARINIZ
KVKK'nın 11. maddesi kapsamında; kişisel verilerinize erişim, düzeltme, silme ve işlemenin kısıtlanmasını talep etme haklarına sahipsiniz.

6. İLETİŞİM
Talepleriniz için platform üzerinden iletişime geçebilirsiniz.`]);
  }

  console.log('PostgreSQL bağlantısı ve tablolar hazır.');
}

module.exports = { query, pool, initDb };

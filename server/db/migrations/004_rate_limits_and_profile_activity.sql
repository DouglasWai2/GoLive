BEGIN;

SELECT pg_advisory_xact_lock(73492815);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 3) THEN
    RAISE EXCEPTION 'Apply 003_multi_room_profiles_and_retention.sql before 004_rate_limits_and_profile_activity.sql';
  END IF;

  ALTER TABLE guest_profiles
    ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

  CREATE INDEX IF NOT EXISTS guest_profiles_last_seen_at_idx ON guest_profiles(last_seen_at);

  CREATE TABLE IF NOT EXISTS api_rate_limits (
    key_hash char(64) PRIMARY KEY,
    hits bigint NOT NULL CHECK (hits > 0),
    expires_at timestamptz NOT NULL
  );
  CREATE INDEX IF NOT EXISTS api_rate_limits_expires_at_idx ON api_rate_limits(expires_at);

  CREATE TABLE IF NOT EXISTS api_ws_connections (
    lease_id uuid PRIMARY KEY,
    ip_hash char(64) NOT NULL,
    expires_at timestamptz NOT NULL
  );
  CREATE INDEX IF NOT EXISTS api_ws_connections_ip_expires_at_idx ON api_ws_connections(ip_hash, expires_at);
  CREATE INDEX IF NOT EXISTS api_ws_connections_expires_at_idx ON api_ws_connections(expires_at);

  INSERT INTO schema_migrations (version) VALUES (4) ON CONFLICT (version) DO NOTHING;
END $$;

COMMIT;

BEGIN;

SELECT pg_advisory_xact_lock(73492815);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 4) THEN
    RAISE EXCEPTION 'Apply 004_rate_limits_and_profile_activity.sql before 005_add_auth_room_owners.sql';
  END IF;

  ALTER TABLE rooms ADD COLUMN IF NOT EXISTS owner_auth_user_id varchar(255);
  ALTER TABLE guest_profiles ADD COLUMN IF NOT EXISTS auth_user_id varchar(255);
  CREATE INDEX IF NOT EXISTS rooms_auth_owner_active_idx
    ON rooms (owner_auth_user_id)
    WHERE owner_auth_user_id IS NOT NULL AND empty_since IS NULL;
  CREATE INDEX IF NOT EXISTS guest_profiles_auth_user_id_idx ON guest_profiles (auth_user_id)
    WHERE auth_user_id IS NOT NULL;

  INSERT INTO schema_migrations (version) VALUES (5) ON CONFLICT (version) DO NOTHING;
END $$;

COMMIT;

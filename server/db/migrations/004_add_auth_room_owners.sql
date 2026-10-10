BEGIN;

SELECT pg_advisory_xact_lock(73492815);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 3) THEN
    RAISE EXCEPTION 'Apply 003_multi_room_profiles_and_retention.sql before 004_add_auth_room_owners.sql';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 4) THEN
    ALTER TABLE rooms ADD COLUMN owner_auth_user_id varchar(255);
    ALTER TABLE guest_profiles ADD COLUMN auth_user_id varchar(255);
    CREATE INDEX rooms_auth_owner_active_idx
      ON rooms (owner_auth_user_id)
      WHERE owner_auth_user_id IS NOT NULL AND empty_since IS NULL;
    CREATE INDEX guest_profiles_auth_user_id_idx ON guest_profiles (auth_user_id)
      WHERE auth_user_id IS NOT NULL;

    INSERT INTO schema_migrations (version) VALUES (4);
  END IF;
END $$;

COMMIT;

BEGIN;

SELECT pg_advisory_xact_lock(73492815);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 2) THEN
    RAISE EXCEPTION 'Apply 002_add_room_memberships.sql before 003_multi_room_profiles_and_retention.sql';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 3) THEN
    ALTER TABLE room_memberships DROP CONSTRAINT room_memberships_pkey;
    ALTER TABLE room_memberships ADD PRIMARY KEY (user_id, room_id);

    ALTER TABLE rooms ADD COLUMN empty_since timestamptz;
    UPDATE rooms SET empty_since = now()
      WHERE NOT EXISTS (
        SELECT 1 FROM room_memberships WHERE room_memberships.room_id = rooms.id
      );

    INSERT INTO schema_migrations (version) VALUES (3);
  END IF;
END $$;

COMMIT;

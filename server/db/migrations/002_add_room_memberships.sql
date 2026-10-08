BEGIN;

SELECT pg_advisory_xact_lock(73492815);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 1) THEN
    RAISE EXCEPTION 'Apply 001_create_catalog.sql before 002_add_room_memberships.sql';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 2) THEN
    -- Pre-membership rooms have no verifiable owner. Reset them rather than
    -- allowing someone to claim an old room by guessing its public ID.
    DELETE FROM rooms;

    ALTER TABLE rooms ADD COLUMN generation uuid NOT NULL DEFAULT gen_random_uuid();
    ALTER TABLE guest_profiles ADD COLUMN credential_hash char(64) UNIQUE;

    CREATE TABLE room_memberships (
      user_id uuid PRIMARY KEY REFERENCES guest_profiles(id) ON DELETE CASCADE,
      room_id varchar(64) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      owner boolean NOT NULL DEFAULT false
    );
    CREATE INDEX room_memberships_room_id_idx ON room_memberships(room_id);

    INSERT INTO schema_migrations (version) VALUES (2);
  END IF;
END $$;

COMMIT;

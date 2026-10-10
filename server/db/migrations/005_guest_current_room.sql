BEGIN;

SELECT pg_advisory_xact_lock(73492815);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 4) THEN
    RAISE EXCEPTION 'Apply 004_add_auth_room_owners.sql before 005_guest_current_room.sql';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 5) THEN
    ALTER TABLE guest_profiles
      ADD COLUMN guest_room_id varchar(64) REFERENCES rooms(id) ON DELETE SET NULL;

    -- Restore up to five retained account-owned rooms to each linked device
    -- profile. This repairs account grants removed by the prior guest switch.
    WITH ranked_rooms AS (
      SELECT
        rooms.id,
        rooms.owner_auth_user_id,
        row_number() OVER (
          PARTITION BY rooms.owner_auth_user_id
          ORDER BY (rooms.empty_since IS NULL) DESC,
                   rooms.empty_since DESC NULLS FIRST,
                   rooms.created_at DESC,
                   rooms.id DESC
        ) AS position
      FROM rooms
      WHERE rooms.owner_auth_user_id IS NOT NULL
    ), eligible_rooms AS (
      SELECT id, owner_auth_user_id
      FROM ranked_rooms
      WHERE position <= 5
        AND EXISTS (
          SELECT 1 FROM guest_profiles
          WHERE guest_profiles.auth_user_id = ranked_rooms.owner_auth_user_id
        )
    ), restored_memberships AS (
    INSERT INTO room_memberships (user_id, room_id, owner)
    SELECT guest_profiles.id, eligible_rooms.id, true
    FROM guest_profiles
    JOIN eligible_rooms ON eligible_rooms.owner_auth_user_id = guest_profiles.auth_user_id
    ON CONFLICT (user_id, room_id) DO UPDATE SET owner = true
    RETURNING room_id
    )

    UPDATE rooms
    SET empty_since = NULL
    WHERE id IN (SELECT room_id FROM restored_memberships);

    UPDATE guest_profiles AS profiles
    SET guest_room_id = (
      SELECT rooms.id
      FROM room_memberships
      JOIN rooms ON rooms.id = room_memberships.room_id
      WHERE room_memberships.user_id = profiles.id
        AND rooms.owner_auth_user_id IS DISTINCT FROM profiles.auth_user_id
      ORDER BY rooms.created_at DESC, rooms.id DESC
      LIMIT 1
    )
    WHERE profiles.auth_user_id IS NOT NULL;

    INSERT INTO schema_migrations (version) VALUES (5);
  END IF;
END $$;

COMMIT;

BEGIN;

SELECT pg_advisory_xact_lock(73492815);
CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 1) THEN
    CREATE TABLE rooms (
      id varchar(64) PRIMARY KEY,
      name varchar(80) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT rooms_id_format CHECK (id ~ '^[A-Za-z0-9_-]{8,64}$'),
      CONSTRAINT rooms_name_nonempty CHECK (length(btrim(name)) > 0)
    );

    CREATE TABLE guest_profiles (
      id uuid PRIMARY KEY,
      name varchar(32) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT guest_profiles_name_nonempty CHECK (length(btrim(name)) > 0)
    );

    INSERT INTO schema_migrations (version) VALUES (1);
  END IF;
END $$;

COMMIT;

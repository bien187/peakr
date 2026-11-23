-- Geteilte Listen: eine Person legt eine Liste an und lädt andere über einen
-- Link ein; alle Mitglieder können Ziele hinzufügen und entfernen.

CREATE TABLE IF NOT EXISTS "lists" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name"         text NOT NULL,
  "owner_id"     uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  -- Geheimnis des Einladungslinks (zufällig, URL-tauglich)
  "invite_token" text NOT NULL UNIQUE,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Mitglieder einschliesslich der Besitzerin bzw. des Besitzers (role 'owner').
CREATE TABLE IF NOT EXISTS "list_members" (
  "list_id"   uuid NOT NULL REFERENCES "lists"("id") ON DELETE CASCADE,
  "user_id"   uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role"      text NOT NULL DEFAULT 'member',
  "joined_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("list_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_members_user_idx" ON "list_members" ("user_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "list_items" (
  "list_id"        uuid NOT NULL REFERENCES "lists"("id") ON DELETE CASCADE,
  "destination_id" uuid NOT NULL REFERENCES "destinations"("id") ON DELETE CASCADE,
  "added_by"       uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "added_at"       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("list_id", "destination_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_items_destination_idx" ON "list_items" ("destination_id");

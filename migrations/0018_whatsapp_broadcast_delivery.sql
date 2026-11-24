ALTER TABLE wa_broadcast_recipients
  ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'pending'
  CHECK(delivery_status IN ('pending','sent','delivered','read','failed'));

ALTER TABLE wa_broadcast_recipients
  ADD COLUMN delivery_updated_at TEXT;

CREATE INDEX wa_broadcast_recipients_message
  ON wa_broadcast_recipients(workspace_id,message_id);

UPDATE wa_broadcast_recipients
SET delivery_status='sent',delivery_updated_at=COALESCE(sent_at,created_at)
WHERE status='sent';

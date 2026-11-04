/*
# Add messages table to realtime for room-scoped messages

## Overview
The messages table is already in the supabase_realtime publication (added in
migration 20261021184648). Since we're using the same messages table with a
new room_id column, realtime INSERT events will continue to work. The frontend
will filter by room_id in the realtime subscription.

No changes needed to the publication itself — messages is already included.
This migration is a no-op placeholder to confirm the realtime setup is correct
for the new room-scoped messages.

## Note
The frontend subscribes to postgres_changes on the messages table and filters
by room_id in the payload handler. No additional publication changes needed.
*/

-- Messages table is already in supabase_realtime publication from migration 20261021184648
-- No action needed.
SELECT 1;

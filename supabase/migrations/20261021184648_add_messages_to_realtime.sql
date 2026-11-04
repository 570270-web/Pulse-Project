/*
# Add messages table to realtime publication

The messages table was not included in the supabase_realtime publication,
so realtime INSERT events were never delivered to subscribed clients.
This is why chat messages were saved to the database but never appeared
on screen in real-time.
*/

ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

import { useCallback, useEffect, useState } from 'react';
import { supabase, getToken } from '@/lib/supabase';
import type { AdminAnnouncement } from '@/lib/auth';
 
function toLocalInput(iso: string) {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000)
    .toISOString()
    .slice(0, 16);
}
 
function defaultEnd() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return toLocalInput(date.toISOString());
}
 
export default function AnnouncementManager() {
  const [items, setItems] = useState<AdminAnnouncement[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [startsAt, setStartsAt] = useState(
    toLocalInput(new Date().toISOString())
  );
  const [endsAt, setEndsAt] = useState(defaultEnd());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
 
  const load = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setError('Session expired. Please log in again.');
      return;
    }
 
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc(
        'admin_list_announcements',
        { p_token: token }
      );
      if (error) throw error;
      setItems((data ?? []) as AdminAnnouncement[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load announcements.');
    } finally {
      setLoading(false);
    }
  }, []);
 
  useEffect(() => {
    void load();
  }, [load]);
 
  function resetForm() {
    setEditingId(null);
    setTitle('');
    setBody('');
    setStartsAt(toLocalInput(new Date().toISOString()));
    setEndsAt(defaultEnd());
  }
 
  function edit(item: AdminAnnouncement) {
    setEditingId(item.id);
    setTitle(item.title);
    setBody(item.body);
    setStartsAt(toLocalInput(item.starts_at));
    setEndsAt(toLocalInput(item.ends_at));
    setError('');
    setNotice('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
 
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
 
    if (!body.trim()) {
      setError('Announcement text is required.');
      return;
    }
 
    const startDate = new Date(startsAt);
    const endDate = new Date(endsAt);
 
    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime()) ||
      endDate <= startDate
    ) {
      setError('The end time must be later than the start time.');
      return;
    }
 
    const token = getToken();
    if (!token) {
      setError('Session expired. Please log in again.');
      return;
    }
 
    setSaving(true);
    try {
      const { error } = await supabase.rpc(
        'admin_save_announcement',
        {
          p_token: token,
          p_id: editingId,
          p_title: title.trim(),
          p_body: body.trim(),
          p_starts_at: startDate.toISOString(),
          p_ends_at: endDate.toISOString(),
        }
      );
 
      if (error) throw error;
 
      setNotice(editingId ? 'Announcement updated.' : 'Announcement created.');
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save announcement.');
    } finally {
      setSaving(false);
    }
  }
 
  async function remove(item: AdminAnnouncement) {
    if (!window.confirm(`Delete announcement "${item.title || 'Untitled'}"?`)) {
      return;
    }
 
    const token = getToken();
    if (!token) {
      setError('Session expired. Please log in again.');
      return;
    }
 
    setError('');
    setNotice('');
 
    try {
      const { error } = await supabase.rpc(
        'admin_delete_announcement',
        { p_token: token, p_id: item.id }
      );
 
      if (error) throw error;
 
      setNotice('Announcement deleted.');
      if (editingId === item.id) resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete announcement.');
    }
  }
 
  function formatDate(value: string) {
    return new Date(value).toLocaleString([], {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }
 
  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <h2 className="text-lg font-bold">
          {editingId ? 'Edit announcement' : 'Create announcement'}
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Announcements appear in the user's hub during the selected period.
        </p>
 
        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-4 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">
            {notice}
          </p>
        )}
 
        <form onSubmit={save} className="mt-5 space-y-4">
          <div>
            <label htmlFor="announcement-title" className="mb-1 block text-sm font-medium">
              Title (optional)
            </label>
            <input
              id="announcement-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="Announcement title"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none focus:border-emerald-400"
            />
          </div>
 
          <div>
            <label htmlFor="announcement-body" className="mb-1 block text-sm font-medium">
              Announcement text
            </label>
            <textarea
              id="announcement-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              maxLength={10000}
              rows={6}
              placeholder="Write your announcement..."
              className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none focus:border-emerald-400"
            />
          </div>
 
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="announcement-start" className="mb-1 block text-sm font-medium">
                Display starts
              </label>
              <input
                id="announcement-start"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                required
                className="w-full min-w-0 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-emerald-400"
              />
            </div>
            <div>
              <label htmlFor="announcement-end" className="mb-1 block text-sm font-medium">
                Display ends
              </label>
              <input
                id="announcement-end"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                required
                className="w-full min-w-0 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-emerald-400"
              />
            </div>
          </div>
 
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Publish announcement'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm hover:bg-slate-800"
              >
                Cancel edit
              </button>
            )}
          </div>
        </form>
      </div>
 
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">All announcements ({items.length})</h2>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
 
        <div className="mt-4 space-y-3">
          {!loading && items.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-400">
              No announcements yet.
            </p>
          )}
 
          {items.map((item) => {
            const now = Date.now();
            const start = new Date(item.starts_at).getTime();
            const end = new Date(item.ends_at).getTime();
            const status = now < start ? 'Scheduled' : now >= end ? 'Expired' : 'Active';
 
            return (
              <article key={item.id} className="rounded-xl border border-slate-800 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">
                        {item.title || 'Untitled announcement'}
                      </h3>
                      <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300">
                        {status}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-300">
                      {item.body}
                    </p>
                    <p className="mt-3 text-xs text-slate-500">
                      {formatDate(item.starts_at)} – {formatDate(item.ends_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => edit(item)}
                      className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(item)}
                      className="rounded-lg border border-red-500/30 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
import { LogOut, AlertTriangle, MessageCircle, Plus, Search, Globe, Lock, Hash, Sun, Moon, Loader2, ArrowRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  getJoinedRooms,
  listPublicRooms,
  findRoomByCode,
  joinRoom,
  leaveRoom,
  requestRoomCreation,
  type RoomSummary,
  type RoomVisibility,
  getUnreadAnnouncements,
  markAnnouncementRead,
  type Announcement,
} from '@/lib/auth';
import { useTheme } from '@/lib/useTheme';

type HubScreenProps = {
  nickname: string;
  onLogout: () => void;
  onEnterRoom: (room: RoomSummary) => void;
};

type HubTab = 'joined' | 'find';

export default function HubScreen({
  nickname,
  onLogout,
  onEnterRoom,
}: HubScreenProps) {
  const { theme, toggleTheme } = useTheme();
  const [confirmRoomAction, setConfirmRoomAction] =
    useState<RoomSummary | null>(null);

  const [deletingRoom, setDeletingRoom] = useState(false);
  const [tab, setTab] = useState<HubTab>('joined');
  const [joinedRooms, setJoinedRooms] = useState<RoomSummary[]>([]);
  const [publicRooms, setPublicRooms] = useState<RoomSummary[]>([]);
  const [searchCode, setSearchCode] = useState('');
  const [foundRoom, setFoundRoom] = useState<RoomSummary | null>(null);

  const [roomName, setRoomName] = useState('');
  const [visibility, setVisibility] = useState<RoomVisibility>('public');
  const [showCreateForm, setShowCreateForm] = useState(false);

  const [password, setPassword] = useState('');
  const [passwordRoom, setPasswordRoom] = useState<RoomSummary | null>(null);

  const [loading, setLoading] = useState(false);
  const [joiningCode, setJoiningCode] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refreshRooms = useCallback(async () => {
    const [joined, publicList] = await Promise.all([
      getJoinedRooms(),
      listPublicRooms(),
    ]);

    setJoinedRooms(joined);
    setPublicRooms(publicList);
  }, []);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementError, setAnnouncementError] = useState('');
  const [markingRead, setMarkingRead] = useState(false);
  
  const loadAnnouncements = useCallback(async () => {
    try {
      const items = await getUnreadAnnouncements();
      setAnnouncements(items);
      setAnnouncementError('');
    } catch (err) {
      setAnnouncementError(
        err instanceof Error ? err.message : 'Could not load announcements.'
      );
    }
  }, []);
  
  useEffect(() => {
    void loadAnnouncements();
  }, [loadAnnouncements]);
  
  const closeAnnouncement = async () => {
    const current = announcements[0];
    if (!current || markingRead) return;
  
    setMarkingRead(true);
    setAnnouncementError('');
  
    try {
      await markAnnouncementRead(current.id);
      setAnnouncements((items) =>
        items.filter((item) => item.id !== current.id)
      );
    } catch (err) {
      setAnnouncementError(
        err instanceof Error ? err.message : 'Could not mark announcement as read.'
      );
    } finally {
      setMarkingRead(false);
    }
  };
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');

      try {
        const [joined, publicList] = await Promise.all([
          getJoinedRooms(),
          listPublicRooms(),
        ]);

        if (!cancelled) {
          setJoinedRooms(joined);
          setPublicRooms(publicList);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load rooms.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleLeaveRoom = async () => {
    if (!confirmRoomAction || deletingRoom) return;

    const room = confirmRoomAction;

    setDeletingRoom(true);
    setError('');
    setNotice('');

    try {
      const result = await leaveRoom(room.id);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setConfirmRoomAction(null);
      await refreshRooms();

      setNotice(
        result.result === 'room_deleted'
          ? 'Room deleted successfully.'
          : 'You left the room.',
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not leave the room.',
      );
    } finally {
      setDeletingRoom(false);
    }
  };

  const handleSearch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setFoundRoom(null);

    const code = searchCode.trim();

    if (!code) {
      setError('Enter a room code first.');
      return;
    }

    setLoading(true);

    try {
      const room = await findRoomByCode(code);

      if (!room) {
        setError('No room was found with that code.');
      } else {
        setFoundRoom(room);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not search for the room.',
      );
    } finally {
      setLoading(false);
    }
  };

  const startJoin = (room: RoomSummary) => {
    setError('');
    setNotice('');

    const alreadyJoined = joinedRooms.some(
      (joined) => joined.id === room.id,
    );

    if (alreadyJoined) {
      void enterRoom(room);
      return;
    }

    if (room.visibility === 'restricted') {
      setPassword('');
      setPasswordRoom(room);
      return;
    }

    void enterRoom(room);
  };

  const enterRoom = async (room: RoomSummary, roomPassword?: string) => {
    setJoiningCode(room.code);
    setError('');

    try {
      const result = await joinRoom(room.code, roomPassword);

      if (!result.ok || !result.room) {
        setError(result.error ?? 'Could not enter the room.');
        return;
      }

      await refreshRooms();
      setPasswordRoom(null);
      setPassword('');
      onEnterRoom(result.room);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not enter the room.',
      );
    } finally {
      setJoiningCode(null);
    }
  };

  const handlePasswordSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!passwordRoom) return;

    void enterRoom(passwordRoom, password);
  };

  const handleCreateRequest = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setError('');
    setNotice('');

    const name = roomName.trim();

    if (name.length < 2 || name.length > 50) {
      setError('Room name must be between 2 and 50 characters.');
      return;
    }

    setLoading(true);

    try {
      const result = await requestRoomCreation(name, visibility);

      if (!result.ok) {
        setError(result.error ?? 'Could not submit the room request.');
        return;
      }

      setRoomName('');
      setShowCreateForm(false);
      setNotice(
        'Your room creation request was submitted for admin review.',
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not submit the room request.',
      );
    } finally {
      setLoading(false);
    }
  };

  const getAvatarColor = (name: string) => {
    const colors = [
      'from-cyan-400 to-blue-500',
      'from-emerald-400 to-teal-500',
      'from-rose-400 to-pink-500',
      'from-amber-400 to-orange-500',
      'from-sky-400 to-indigo-500',
      'from-lime-400 to-green-500',
      'from-fuchsia-400 to-pink-500',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const renderRoom = (room: RoomSummary, description?: string) => (
    <div
      key={room.id}
      className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-slate-700"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${getAvatarColor(room.name)} font-bold text-white text-sm`}>
            {room.name.charAt(0).toUpperCase()}
          </div>
          <h3 className="truncate font-semibold text-slate-900 dark:text-slate-100">
            {room.name}
          </h3>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 font-mono text-xs dark:bg-slate-800">
            <Hash className="h-3 w-3" />
            {room.code}
          </span>

          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
            room.visibility === 'public'
              ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
              : 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400'
          }`}>
            {room.visibility === 'public' ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
            {room.visibility === 'public' ? 'Public' : 'Restricted'}
          </span>
        </div>

        {description && (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{description}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => startJoin(room)}
          disabled={joiningCode !== null || loading}
          className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {joiningCode === room.code ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Joining…</>
          ) : (
            <>Enter <ArrowRight className="h-4 w-4" /></>
          )}
        </button>

        {tab === 'joined' && room.role !== 'admin' && (
          <button
            type="button"
            onClick={() => setConfirmRoomAction(room)}
            disabled={joiningCode !== null || loading}
            title="Leave room"
            aria-label={`Leave ${room.name}`}
            className="rounded-lg border border-slate-200 px-2.5 py-2 text-sm text-slate-500 transition hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:border-slate-700 dark:hover:border-red-500/40 dark:hover:bg-red-500/10 dark:hover:text-red-400"
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 shadow-lg shadow-cyan-500/20">
              <MessageCircle className="h-5 w-5 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Pulse</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">Your chat hub</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 sm:flex dark:bg-slate-800/60">
              <div className={`flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br ${getAvatarColor(nickname)} text-sm font-bold text-white`}>
                {nickname.charAt(0).toUpperCase()}
              </div>
              <span className="max-w-36 truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                {nickname}
              </span>
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              title="Toggle theme"
              className="rounded-lg border border-slate-200 bg-slate-100 p-2 text-slate-500 transition hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400 dark:hover:text-white"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <button
              type="button"
              onClick={onLogout}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-600 transition hover:bg-red-50 hover:text-red-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400 dark:hover:bg-red-500/10 dark:hover:text-red-400"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 py-8">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Welcome to Pulse</h2>
            <p className="mt-2 text-slate-500 dark:text-slate-400">
              Join your rooms or discover a new conversation.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setShowCreateForm((current) => !current);
              setError('');
              setNotice('');
            }}
            className="flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-3 font-medium text-white shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400"
          >
            <Plus className="h-5 w-5" />
            Request a room
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400"
          >
            {error}
          </div>
        )}

        {notice && (
          <div
            role="status"
            className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400"
          >
            {notice}
          </div>
        )}

        {showCreateForm && (
          <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/60">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Request room creation</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              An administrator must approve your request before the room is created.
            </p>

            <form onSubmit={handleCreateRequest} className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="room-name"
                  className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                >
                  Room name
                </label>
                <input
                  id="room-name"
                  value={roomName}
                  onChange={(event) => setRoomName(event.target.value)}
                  minLength={2}
                  maxLength={50}
                  required
                  placeholder="Enter a room name"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-800/60 dark:text-white dark:placeholder:text-slate-500"
                />
              </div>

              <fieldset>
                <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Room type
                </legend>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:border-slate-600">
                    <input
                      type="radio"
                      name="room-visibility"
                      value="public"
                      checked={visibility === 'public'}
                      onChange={() => setVisibility('public')}
                      className="mt-1 accent-cyan-500"
                    />
                    <span>
                      <span className="flex items-center gap-1.5 font-medium text-slate-900 dark:text-white">
                        <Globe className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
                        Public
                      </span>
                      <span className="text-sm text-slate-500 dark:text-slate-400">
                        Anyone can find and join the room.
                      </span>
                    </span>
                  </label>

                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:border-slate-600">
                    <input
                      type="radio"
                      name="room-visibility"
                      value="restricted"
                      checked={visibility === 'restricted'}
                      onChange={() => setVisibility('restricted')}
                      className="mt-1 accent-cyan-500"
                    />
                    <span>
                      <span className="flex items-center gap-1.5 font-medium text-slate-900 dark:text-white">
                        <Lock className="h-4 w-4 text-amber-500 dark:text-amber-400" />
                        Restricted
                      </span>
                      <span className="text-sm text-slate-500 dark:text-slate-400">
                        A password will be set after approval.
                      </span>
                    </span>
                  </label>
                </div>
              </fieldset>

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 font-medium text-white transition hover:bg-cyan-400 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  {loading ? 'Submitting…' : 'Submit request'}
                </button>

                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>
        )}

        {passwordRoom && (
          <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/50 p-5 dark:border-amber-500/20 dark:bg-slate-900/60">
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-amber-500 dark:text-amber-400" />
              <h3 className="font-semibold text-slate-900 dark:text-white">
                Enter restricted room: {passwordRoom.name}
              </h3>
            </div>

            <form onSubmit={handlePasswordSubmit} className="mt-4 space-y-3">
              <label htmlFor="room-password" className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Room password
              </label>
              <input
                id="room-password"
                type="password"
                autoComplete="off"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 dark:border-slate-700 dark:bg-slate-800/60 dark:text-white dark:placeholder:text-slate-500"
                placeholder="Enter the room password"
              />

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={joiningCode !== null}
                  className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 font-medium text-white transition hover:bg-amber-400 disabled:opacity-50"
                >
                  {joiningCode ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  {joiningCode ? 'Joining…' : 'Enter room'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPasswordRoom(null);
                    setPassword('');
                  }}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>
        )}

        <div className="mb-5 flex gap-2 border-b border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setTab('joined')}
            className={`border-b-2 px-4 py-3 text-sm font-medium transition ${
              tab === 'joined'
                ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-500 dark:hover:text-slate-300'
            }`}
          >
            My rooms ({joinedRooms.length})
          </button>

          <button
            type="button"
            onClick={() => setTab('find')}
            className={`border-b-2 px-4 py-3 text-sm font-medium transition ${
              tab === 'find'
                ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-500 dark:hover:text-slate-300'
            }`}
          >
            Find rooms
          </button>
        </div>

        {tab === 'joined' && (
          <section>
            <h3 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">Your rooms</h3>

            {loading && joinedRooms.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-500 dark:text-slate-500">
                <Loader2 className="mb-3 h-8 w-8 animate-spin" />
                <p className="text-sm">Loading rooms…</p>
              </div>
            ) : joinedRooms.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white/50 px-5 py-12 text-center dark:border-slate-800 dark:bg-slate-900/40">
                <div className="mb-3 flex justify-center">
                  <MessageCircle className="h-10 w-10 text-slate-300 dark:text-slate-700" />
                </div>
                <h4 className="font-semibold text-slate-700 dark:text-slate-300">No rooms yet</h4>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-500">
                  Find a public room or request your own room to get started.
                </p>
                <button
                  type="button"
                  onClick={() => setTab('find')}
                  className="mt-4 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-400"
                >
                  Find a room
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {joinedRooms.map((room) =>
                  renderRoom(room, room.role ? `Role: ${room.role}` : undefined),
                )}
              </div>
            )}
          </section>
        )}

        {tab === 'find' && (
          <section className="space-y-8">
            <div>
              <h3 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">Find by room code</h3>

              <form onSubmit={handleSearch} className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                  <input
                    value={searchCode}
                    onChange={(event) => setSearchCode(event.target.value)}
                    maxLength={5}
                    placeholder="Enter 5-character code"
                    aria-label="Room code"
                    className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-11 pr-4 font-mono text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-800/60 dark:text-white dark:placeholder:text-slate-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center gap-2 rounded-xl bg-cyan-500 px-5 py-3 font-medium text-white transition hover:bg-cyan-400 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
                  Search
                </button>
              </form>

              {foundRoom && (
                <div className="mt-4">
                  {renderRoom(foundRoom, 'Room found')}
                </div>
              )}
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Public rooms</h3>
                <button
                  type="button"
                  onClick={async () => {
                    setLoading(true);
                    setError('');
                    try {
                      await refreshRooms();
                    } catch (err) {
                      setError(
                        err instanceof Error
                          ? err.message
                          : 'Could not refresh rooms.',
                      );
                    } finally {
                      setLoading(false);
                    }
                  }}
                  disabled={loading}
                  className="text-sm font-medium text-cyan-600 transition hover:text-cyan-700 disabled:opacity-50 dark:text-cyan-400 dark:hover:text-cyan-300"
                >
                  Refresh
                </button>
              </div>

              {publicRooms.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white/50 px-5 py-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-500">
                  {loading
                    ? 'Loading public rooms…'
                    : 'No public rooms are available yet.'}
                </div>
              ) : (
                <div className="space-y-3">
                  {publicRooms.map((room) => {
                    const alreadyJoined = joinedRooms.some(
                      (joined) => joined.id === room.id,
                    );

                    return renderRoom(
                      room,
                      alreadyJoined ? 'Already in your rooms' : undefined,
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Leave/delete room confirmation modal */}
        {confirmRoomAction && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm dark:bg-slate-950/80">
            <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-4 flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 dark:bg-red-500/20">
                  <AlertTriangle className="h-5 w-5 text-red-500 dark:text-red-400" />
                </div>

                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                    {confirmRoomAction.role === 'owner'
                      ? 'Delete Room?'
                      : 'Leave Room?'}
                  </h2>

                  <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                    {confirmRoomAction.role === 'owner'
                      ? `Permanently delete "${confirmRoomAction.name}", including its members and chat history. This cannot be undone.`
                      : `Leave "${confirmRoomAction.name}"? You can rejoin later, and the chat history will remain.`}
                  </p>
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmRoomAction(null)}
                  disabled={deletingRoom}
                  className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={() => void handleLeaveRoom()}
                  disabled={deletingRoom}
                  className="flex items-center gap-1.5 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deletingRoom ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
                  {deletingRoom
                    ? 'Processing…'
                    : confirmRoomAction.role === 'owner'
                      ? 'Delete Room'
                      : 'Leave Room'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {announcements.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="announcement-title"
        >
          <section className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-indigo-200 bg-white text-slate-900 shadow-2xl">
            <header className="shrink-0 border-b border-slate-200 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
                Pulse announcement
              </p>
              <h2 id="announcement-title" className="mt-1 text-xl font-bold">
                {announcements[0].title || 'Announcement'}
              </h2>
            </header>
      
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">
                {announcements[0].body}
              </p>
            </div>
      
            <footer className="shrink-0 border-t border-slate-200 px-5 py-4">
              {announcementError && (
                <p role="alert" className="mb-3 text-sm text-red-600">
                  {announcementError}
                </p>
              )}
      
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-slate-500">
                  {announcements.length > 1
                    ? `${announcements.length} announcements remaining`
                    : 'End of announcements'}
                </span>
      
                <button
                  type="button"
                  onClick={() => void closeAnnouncement()}
                  disabled={markingRead}
                  className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {markingRead
                    ? 'Saving…'
                    : announcements.length > 1
                      ? 'Got it · Next'
                      : 'Got it'}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
      
      {announcementError && announcements.length === 0 && (
        <p role="status" className="mt-3 text-xs text-slate-500">
          Announcements could not be loaded: {announcementError}
        </p>
      )}
    </main>
  );
}

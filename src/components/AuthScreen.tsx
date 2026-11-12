import { useState } from 'react';
import { MessageCircle, Lock, User, ArrowRight, Loader2, Check, Search, Sun, Moon } from 'lucide-react';
import { checkNickname, registerNickname, loginNickname } from '@/lib/auth';
import { setLang } from '@/lib/i18n';
import type { NicknameStatus } from '@/lib/auth';
import { saveToken } from '@/lib/supabase';
import { useTheme } from '@/lib/useTheme';
 
type Props = {
  onAuthSuccess: (nickname: string) => void;
};
 
type Mode = 'idle' | 'available' | 'taken' | 'error';
 
export default function AuthScreen({ onAuthSuccess }: Props) {
  const { theme, toggleTheme } = useTheme();
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mode, setMode] = useState<Mode>('idle');
  const [checkLoading, setCheckLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState('');
 
  const handleCheck = async () => {
    const trimmed = nickname.trim();
    if (trimmed.length < 2) {
      setError('Nickname must be at least 2 characters.');
      return;
    }
    setCheckLoading(true);
    setError('');
    const result: NicknameStatus = await checkNickname(trimmed);
    setCheckLoading(false);
    if (result.status === 'error') {
      setMode('idle');
      setError(result.message);
      return;
    }
    setMode(result.status);
  };
 
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedNick = nickname.trim();
 
    if (mode === 'idle') {
      await handleCheck();
      return;
    }
 
    if (password.length < 4) {
      setError('Password must be at least 4 characters.');
      return;
    }
    if (mode === 'available' && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
 
    setSubmitLoading(true);
    setError('');
 
    const result =
      mode === 'taken'
        ? await loginNickname(trimmedNick, password)
        : await registerNickname(trimmedNick, password);
 
    setSubmitLoading(false);
 
    if (result.ok) {
      saveToken(result.token);

      // 새로 만든 계정은 영어로 시작 (같은 브라우저에 남은 이전 언어 설정 무시)
      if (mode !== 'taken') setLang('en');

      onAuthSuccess(trimmedNick);
    } else {
      setError(result.error);
    }
  };
 
  const switchNickname = () => {
    setNickname('');
    setPassword('');
    setConfirmPassword('');
    setMode('idle');
    setError('');
  };
 
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 relative overflow-hidden dark:bg-slate-950">
      {/* ambient background glow */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-400/10 rounded-full blur-3xl dark:bg-cyan-500/10" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-400/10 rounded-full blur-3xl dark:bg-blue-500/10" />
 
      {/* theme toggle */}
      <button
        type="button"
        onClick={toggleTheme}
        title="Toggle theme"
        className="absolute top-4 right-4 z-10 rounded-lg border border-slate-200 bg-white/80 p-2 text-slate-500 transition hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400 dark:hover:text-white"
      >
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
 
      <div className="relative w-full max-w-md">
        {/* logo header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 shadow-lg shadow-cyan-500/25 mb-4">
            <MessageCircle className="w-8 h-8 text-white" strokeWidth={2.5} />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight dark:text-white">Pulse</h1>
          <p className="text-slate-500 mt-1.5 text-sm dark:text-slate-400">Real-time chat. Pick a name and jump in.</p>
        </div>
 
        {/* auth card */}
        <div className="bg-white/80 backdrop-blur-xl rounded-2xl border border-slate-200 shadow-2xl p-7 dark:bg-slate-900/70 dark:border-slate-800">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* nickname field + check button */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 dark:text-slate-400">
                Nickname
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 dark:text-slate-500" />
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => {
                      setNickname(e.target.value);
                      if (mode !== 'idle') {
                        setMode('idle');
                        setPassword('');
                        setConfirmPassword('');
                        setError('');
                      }
                    }}
                    placeholder="Choose your name"
                    autoComplete="off"
                    maxLength={20}
                    className="w-full bg-slate-100 border border-slate-200 rounded-xl pl-11 pr-10 py-3.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all dark:bg-slate-800/60 dark:border-slate-700 dark:text-white dark:placeholder:text-slate-500"
                  />
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                    {checkLoading && <Loader2 className="w-5 h-5 text-slate-400 animate-spin dark:text-slate-500" />}
                    {!checkLoading && mode === 'available' && (
                      <Check className="w-5 h-5 text-emerald-500 dark:text-emerald-400" />
                    )}
                    {!checkLoading && mode === 'taken' && (
                      <Lock className="w-5 h-5 text-amber-500 dark:text-amber-400" />
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCheck}
                  disabled={checkLoading || nickname.trim().length < 2}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium px-4 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 text-sm dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300"
                >
                  <Search className="w-4 h-4" />
                  Check
                </button>
              </div>
 
              {/* status hint */}
              {mode === 'available' && (
                <p className="text-emerald-600 text-xs mt-2 pl-1 dark:text-emerald-400">Available — set a password to claim it.</p>
              )}
              {mode === 'taken' && (
                <p className="text-amber-600 text-xs mt-2 pl-1 dark:text-amber-400">Taken — enter the password to log in.</p>
              )}
            </div>
 
            {/* password field — shown only after nickname is checked */}
            {(mode === 'available' || mode === 'taken') && (
              <div className="space-y-5 animate-fadeIn">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 dark:text-slate-400">
                    {mode === 'taken' ? 'Password' : 'Set a Password'}
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 dark:text-slate-500" />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={mode === 'taken' ? 'Enter password' : 'Create a password'}
                      autoComplete={mode === 'taken' ? 'current-password' : 'new-password'}
                      className="w-full bg-slate-100 border border-slate-200 rounded-xl pl-11 pr-4 py-3.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all dark:bg-slate-800/60 dark:border-slate-700 dark:text-white dark:placeholder:text-slate-500"
                    />
                  </div>
                </div>
 
                {mode === 'available' && (
                  <div className="animate-fadeIn">
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 dark:text-slate-400">
                      Confirm Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 dark:text-slate-500" />
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter password"
                        autoComplete="new-password"
                        className="w-full bg-slate-100 border border-slate-200 rounded-xl pl-11 pr-4 py-3.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all dark:bg-slate-800/60 dark:border-slate-700 dark:text-white dark:placeholder:text-slate-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
 
            {/* error */}
            {error && (
              <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 animate-fadeIn dark:text-red-400 dark:bg-red-500/10 dark:border-red-500/20">
                {error}
              </p>
            )}
 
            {/* submit */}
            <button
              type="submit"
              disabled={submitLoading || (mode === 'available' && (!password || !confirmPassword)) || (mode === 'taken' && !password)}
              className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold py-3.5 rounded-xl flex items-center justify-center gap-2 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30 active:scale-[0.98]"
            >
              {submitLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  {mode === 'taken' ? 'Log In' : mode === 'available' ? 'Claim & Join' : 'Check Nickname'}
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>
 
          {nickname.trim().length >= 2 && (mode === 'taken' || mode === 'available') && (
            <button
              onClick={switchNickname}
              className="w-full text-center text-slate-400 hover:text-slate-600 text-sm mt-4 transition-colors dark:text-slate-500 dark:hover:text-slate-300"
            >
              Use a different nickname
            </button>
          )}
        </div>
 
        <p className="text-center text-slate-400 text-xs mt-6 dark:text-slate-600">
          Nicknames inactive for 6 months are automatically released.
        </p>
      </div>
    </div>
  );
}
 
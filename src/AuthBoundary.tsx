import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { LogIn } from 'lucide-react';
import { api, resetSessionRequests, watchSessionExpiry } from './api';
import './auth.css';
import { errorText, LanguageSelector, useMessages, type TextValue } from './i18n';
import { shellMessages } from './locales/shell';
import { connectSessionLogout } from './session-sync';
import { Brand } from './components/Brand';

const AuthContext = createContext<{ logout?: () => void }>({});
export const useAuthentication = () => useContext(AuthContext);

type View = 'checking' | 'login' | 'ready' | 'logging-out' | 'logout-failed';

export function AuthBoundary({ children }: { children: ReactNode }) {
  const { t, m, text } = useMessages(shellMessages);
  const [view, setView] = useState<View>('checking');
  const viewRef = useRef<View>('checking');
  const [required, setRequired] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState<TextValue>('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const operation = useRef(0);
  const passwordInput = useRef<HTMLInputElement>(null);
  const logoutSync = useRef<ReturnType<typeof connectSessionLogout> | null>(null);

  const showView = (next: View) => {
    viewRef.current = next;
    setView(next);
  };

  const invalidateSession = (message: TextValue = '') => {
    operation.current += 1;
    resetSessionRequests(false);
    setPassword('');
    setPending(false);
    setError(message);
    showView('login');
  };

  const checkSession = async () => {
    const id = ++operation.current;
    resetSessionRequests(false);
    showView('checking');
    setError('');
    try {
      const session = await api.session();
      if (id !== operation.current) return;
      setRequired(session.required);
      if (session.authenticated) {
        setGeneration(resetSessionRequests(true));
        showView('ready');
      } else showView('login');
    } catch (issue) {
      if (id === operation.current) setError(errorText(issue, m('unreachable')));
    }
  };

  useEffect(() => {
    const stop = watchSessionExpiry(() => invalidateSession(m('sessionExpired')));
    const sync = connectSessionLogout(() => {
      // Private data is already hidden; keep our own logout request and retry intact.
      if (viewRef.current === 'logging-out' || viewRef.current === 'logout-failed') return;
      invalidateSession();
    });
    logoutSync.current = sync;
    let verifying = false;
    const verifyActiveSession = async () => {
      if (document.visibilityState !== 'visible' || viewRef.current !== 'ready' || verifying) return;
      const id = operation.current;
      verifying = true;
      try {
        const session = await api.session();
        if (id === operation.current && viewRef.current === 'ready' && !session.authenticated) invalidateSession(m('sessionExpired'));
      } catch { /* An unreachable server is not evidence that the session expired. Preserve drafts. */ }
      finally { verifying = false; }
    };
    const onActive = () => { void verifyActiveSession(); };
    window.addEventListener('focus', onActive);
    window.addEventListener('pageshow', onActive);
    document.addEventListener('visibilitychange', onActive);
    void checkSession();
    return () => {
      operation.current += 1;
      resetSessionRequests(false);
      stop();
      sync.close();
      if (logoutSync.current === sync) logoutSync.current = null;
      window.removeEventListener('focus', onActive);
      window.removeEventListener('pageshow', onActive);
      document.removeEventListener('visibilitychange', onActive);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- session listeners are installed once for the lifetime of the boundary.
  }, []);

  useEffect(() => { if (view === 'login' && !pending) passwordInput.current?.focus(); }, [view, pending]);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || !password) return;
    const id = ++operation.current;
    const submittedPassword = password;
    setPassword('');
    setPending(true);
    setError('');
    try {
      const session = await api.login(submittedPassword);
      if (id !== operation.current) return;
      if (!session.authenticated) throw m('loginFailedRetry');
      setRequired(session.required);
      setGeneration(resetSessionRequests(true));
      showView('ready');
    } catch (issue) {
      if (id === operation.current) {
        setError(errorText(issue, m('loginFailedRetry')));
      }
    } finally { if (id === operation.current) setPending(false); }
  };

  const logout = async () => {
    const id = ++operation.current;
    // Hide all private data before waiting for the server, including failed requests.
    resetSessionRequests(false);
    showView('logging-out');
    setPassword('');
    setError('');
    logoutSync.current?.publish();
    try {
      await api.logout();
      if (id === operation.current) showView('login');
    } catch {
      if (id === operation.current) {
        showView('logout-failed');
        setError(m('logoutFailed'));
      }
    }
  };

  if (view === 'ready') return <AuthContext.Provider value={{ logout: required ? () => { void logout(); } : undefined }}><div key={generation}>{children}</div></AuthContext.Provider>;

  return <div className="auth-shell">
    <header className="auth-header"><span className="brand"><Brand /></span><LanguageSelector /></header>
    <main className="auth-main">
      <section className="auth-panel" aria-labelledby="auth-heading" aria-busy={pending || view === 'checking' && !error || view === 'logging-out'}>
        <h1 id="auth-heading">{view === 'logout-failed' ? t('finishLogout') : t('yourAccount')}</h1>
        {view === 'login' ? <>
          <p className="auth-description">{t('loginDescription')}</p>
          <form onSubmit={event => { void login(event); }}>
            <label className="field" htmlFor="login-password">{t('password')}
              <input ref={passwordInput} id="login-password" name="password" type="password" autoComplete="current-password" required maxLength={512} value={password} disabled={pending} onChange={event => setPassword(event.target.value)} aria-describedby={error ? 'auth-error' : undefined} />
            </label>
            {error && <p id="auth-error" className="form-error" role="alert">{text(error)}</p>}
            <button className="button primary auth-submit" disabled={pending || !password} type="submit">{pending ? <><span className="spinner" aria-hidden="true" />{t('signingIn')}</> : <><LogIn size={17} />{t('signIn')}</>}</button>
          </form>
        </> : <>
          {error ? <p id="auth-error" className="form-error" role="alert">{text(error)}</p> : <p className="auth-status" role="status"><span className="spinner" aria-hidden="true" />{view === 'logging-out' ? t('signingOut') : t('checkingConnection')}</p>}
          {error && <button className="button secondary auth-submit" onClick={() => { void (view === 'logout-failed' ? logout() : checkSession()); }}>{view === 'logout-failed' ? t('retryLogout') : t('reconnect')}</button>}
        </>}
      </section>
    </main>
  </div>;
}

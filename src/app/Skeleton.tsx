import './loading.css';
import { parseRoute } from './router.ts';

export function Skeleton({ className = '' }: { className?: string }) {
  return <span className={`chrome-skeleton ${className}`} aria-hidden="true" />;
}

function savedListView() {
  try { return localStorage.getItem('plastic:home-view') === 'list'; } catch { return false; }
}

export function FileSkeletons({ list = false }: { list?: boolean }) {
  return <div className={list ? 'skeleton-file-list' : 'home-grid skeleton-file-grid'} role="status" aria-label="Loading Files" aria-busy="true">
    {Array.from({ length: 6 }, (_, i) => <div className="skeleton-file" key={i}>{list && <Skeleton className="skeleton-preview" />}<div className="skeleton-file-text"><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line short" /></div>{!list && <Skeleton className="skeleton-preview" />}</div>)}
  </div>;
}

export function CodeSkeleton() {
  return <section className="code-panel skeleton-code" role="status" aria-label="Loading Code" aria-busy="true">
    {Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className={`skeleton-line${i % 3 === 0 ? ' short' : ''}`} />)}
  </section>;
}

export function ProfileActivitySkeleton() {
  return <div role="status" aria-label="Loading Activity" aria-busy="true">
    <div className="skeleton-profile-stats">{Array.from({ length: 5 }, (_, i) => <div key={i}><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line short" /></div>)}</div>
    <div className="skeleton-toolbar"><Skeleton className="skeleton-line" /><Skeleton className="skeleton-tool" /></div>
    <Skeleton className="skeleton-activity-grid" />
  </div>;
}

export function ProfileSkeleton() {
  return <div className="skeleton-profile" role="status" aria-label="Loading Profile" aria-busy="true">
    <div className="skeleton-profile-identity"><Skeleton className="skeleton-avatar" /><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line short" /></div>
    <ProfileActivitySkeleton />
  </div>;
}

export function PanelSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return <div className="skeleton-panel" role="status" aria-label={label} aria-busy="true">
    {Array.from({ length: rows }, (_, i) => <div className="skeleton-panel-row" key={i}><Skeleton className="skeleton-line short" /><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line" /></div>)}
  </div>;
}

export function AuthSkeleton() {
  return <div className="skeleton-auth" role="status" aria-label="Loading Sign In" aria-busy="true"><div className="skeleton-auth-card">
    <Skeleton className="skeleton-auth-mark" /><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line short" />
    {Array.from({ length: 4 }, (_, i) => <Skeleton className="skeleton-auth-field" key={i} />)}
    <Skeleton className="skeleton-line short" />
  </div></div>;
}

export function AppSkeleton({ editor, screen = parseRoute(location.pathname).name }: { editor?: boolean; screen?: ReturnType<typeof parseRoute>['name'] }) {
  const auth = /^\/(login|sign-in|sign-up)(\/|$)/.test(location.pathname) || new URLSearchParams(location.search).has('auth');
  if (auth && editor === undefined) return <AuthSkeleton />;
  editor ??= screen === 'file';
  return <div className={`app-skeleton ${editor ? 'is-editor' : 'is-home'}`} role="status" aria-label={editor ? 'Opening File' : `Loading ${screen === 'home' ? 'Recents' : screen === 'admin' ? 'Waitlist' : screen.charAt(0).toUpperCase() + screen.slice(1)}`} aria-busy="true">
    <aside className="skeleton-sidebar"><Skeleton className="skeleton-brand" /><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line short" />
      {Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className={`skeleton-line${i % 2 ? ' short' : ''}`} />)}
    </aside>
    <main className="skeleton-main"><div className="skeleton-toolbar"><Skeleton className="skeleton-line" /><Skeleton className="skeleton-tool" /></div>
      {editor ? <div className="skeleton-artboard"><Skeleton className="skeleton-line short" /><Skeleton className="skeleton-line" /><Skeleton className="skeleton-block" /></div> : screen === 'profile' ? <ProfileSkeleton /> : screen === 'admin' ? <div className="skeleton-admin"><div className="skeleton-admin-tabs">{Array.from({ length: 4 }, (_, i) => <Skeleton className="skeleton-tool" key={i} />)}</div><PanelSkeleton label="Loading Waitlist" rows={6} /></div> : <FileSkeletons list={savedListView()} />}
    </main>
    {editor && <aside className="skeleton-inspector">{Array.from({ length: 8 }, (_, i) => <div className="skeleton-field-pair" key={i}><Skeleton /><Skeleton /></div>)}</aside>}
  </div>;
}

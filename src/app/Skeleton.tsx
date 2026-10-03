import './loading.css';

export function Skeleton({ className = '' }: { className?: string }) {
  return <span className={`chrome-skeleton ${className}`} aria-hidden="true" />;
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

export function AppSkeleton({ editor = location.pathname.startsWith('/file/') }: { editor?: boolean }) {
  return <div className={`app-skeleton ${editor ? 'is-editor' : 'is-home'}`} role="status" aria-label={editor ? 'Opening File' : 'Loading Plastic'} aria-busy="true">
    <aside className="skeleton-sidebar"><Skeleton className="skeleton-brand" /><Skeleton className="skeleton-line" /><Skeleton className="skeleton-line short" />
      {Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className={`skeleton-line${i % 2 ? ' short' : ''}`} />)}
    </aside>
    <main className="skeleton-main"><div className="skeleton-toolbar"><Skeleton className="skeleton-line" /><Skeleton className="skeleton-tool" /></div>
      {editor ? <div className="skeleton-artboard"><Skeleton className="skeleton-line short" /><Skeleton className="skeleton-line" /><Skeleton className="skeleton-block" /></div> : <FileSkeletons />}
    </main>
    {editor && <aside className="skeleton-inspector">{Array.from({ length: 8 }, (_, i) => <div className="skeleton-field-pair" key={i}><Skeleton /><Skeleton /></div>)}</aside>}
  </div>;
}

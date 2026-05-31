import type { PropsWithChildren } from "react";

export function AppShell({ children }: PropsWithChildren) {
  return <div className="grid h-full w-full max-w-full grid-rows-[minmax(0,1fr)_clamp(210px,26vh,280px)] overflow-hidden bg-console-bg text-console-text">{children}</div>;
}

export function Panel({ title, children, className = "" }: PropsWithChildren<{ title: string; className?: string }>) {
  return (
    <section className={`grid min-h-0 min-w-0 grid-rows-[28px_minmax(0,1fr)] overflow-hidden border border-console-line bg-console-panel ${className}`}>
      <div className="panel-title">{title}</div>
      <div className="min-h-0 min-w-0 overflow-hidden">{children}</div>
    </section>
  );
}

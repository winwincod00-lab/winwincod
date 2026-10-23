export default function ProductThumbnail({ src, name, className = '' }: { src?: string; name: string; className?: string }) {
  return <span className={'relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-slate-400 ' + className}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-6" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v8l9 5 9-5V8M12 13v8" /></svg>
    {src && /* Existing catalog URLs may be remote; preserve fallback on load failure. */
      // eslint-disable-next-line @next/next/no-img-element
      <img key={src} src={src} alt={name} loading="lazy" className="absolute inset-0 size-full object-cover" onError={event => { event.currentTarget.hidden = true; }} />}
  </span>;
}

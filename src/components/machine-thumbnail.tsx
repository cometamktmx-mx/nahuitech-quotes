type MachineThumbnailProps = {
  name: string;
  imageUrl: string | null;
  className?: string;
};

function MachineIcon() {
  return (
    <svg aria-hidden="true" className="size-12" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M3.5 17h17v3h-17z" />
      <path d="M6.5 17v-6h11v6M9 11V6h6v5" />
      <path d="M6.5 20.5h.01M17.5 20.5h.01M12 6V3.5" />
    </svg>
  );
}

export function MachineThumbnail({ name, imageUrl, className = "" }: MachineThumbnailProps) {
  if (imageUrl) {
    return (
      <div className={`relative overflow-hidden bg-surface-muted ${className}`}>
        {/* External image URLs are catalog data and do not require a Next image loader. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt={name} className="size-full object-contain p-3 sm:p-5" src={imageUrl} />
      </div>
    );
  }

  return (
    <div aria-label={`Imagen pendiente de ${name}`} className={`relative grid place-items-center overflow-hidden bg-graphite text-on-graphite ${className}`} role="img">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,transparent_0%,rgba(6,174,184,0.18)_100%)]" />
      <div className="relative grid place-items-center gap-3 p-5 text-center">
        <span className="grid size-16 place-items-center rounded-2xl border border-primary/30 bg-primary/10 text-primary"><MachineIcon /></span>
        <span className="max-w-48 text-sm font-bold leading-5 text-on-graphite/85">{name}</span>
      </div>
    </div>
  );
}

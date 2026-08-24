import { type ButtonHTMLAttributes, type ReactNode } from "react";

function joinClasses(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export const primaryButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-primary)] transition active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50";

export const secondaryButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-5 py-3 text-sm font-semibold text-foreground transition active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50";

export function PrimaryButton({
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={joinClasses(primaryButtonClass, className)} type={type} {...props} />;
}

export function SecondaryButton({
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={joinClasses(secondaryButtonClass, className)} type={type} {...props} />;
}

export function SectionCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={joinClasses(
        "rounded-2xl border border-border bg-surface shadow-[var(--shadow-card)]",
        className
      )}
    >
      {children}
    </section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl">
        {eyebrow ? (
          <div className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-primary">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-3xl font-bold tracking-[-0.03em] text-foreground sm:text-4xl">
          {title}
        </h1>
        {description ? <p className="mt-3 text-base leading-7 text-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

type StatusTone = "success" | "warning" | "danger" | "primary" | "neutral";

const statusClasses: Record<StatusTone, string> = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
  primary: "bg-primary/10 text-primary-hover",
  neutral: "bg-surface-muted text-muted",
};

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: StatusTone;
}) {
  return (
    <span className={joinClasses("inline-flex min-h-7 items-center rounded-full px-3 text-xs font-bold", statusClasses[tone])}>
      {children}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <SectionCard className="grid min-h-80 place-items-center p-8 text-center">
      <div className="max-w-md">
        <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary">
          {icon}
        </div>
        <h2 className="mt-6 text-xl font-bold text-foreground">{title}</h2>
        <p className="mt-3 text-base leading-7 text-muted">{description}</p>
        {action ? <div className="mt-7">{action}</div> : null}
      </div>
    </SectionCard>
  );
}

export function BrandMark() {
  return (
    <div className="inline-flex items-center gap-3">
      <span className="grid size-10 place-items-center rounded-xl bg-primary text-lg font-black tracking-[-0.08em] text-primary-foreground shadow-[var(--shadow-primary)]">
        N
      </span>
      <span className="text-base font-black tracking-[0.12em] text-foreground">NAHUITECH</span>
    </div>
  );
}

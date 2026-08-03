import { cn } from "../lib/utils";

/**
 * The shared liveness mark from the expressive design language. Motion is
 * supplementary: the visible label and surrounding status copy still carry
 * the state when reduced motion disables the ping.
 */
export function LiveDot({
  className,
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span aria-hidden className="relative flex size-2.5 items-center justify-center">
        <span className="absolute size-2.5 animate-ping rounded-full bg-primary/40 motion-reduce:animate-none" />
        <span className="size-1.5 rounded-full bg-primary" />
      </span>
      {label ? <span>{label}</span> : <span className="sr-only">Live</span>}
    </span>
  );
}

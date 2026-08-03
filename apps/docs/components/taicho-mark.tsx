export function TaichoMark({ className = "size-6" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M7 17.5 12 6.5M12 6.5 17 17.5M7 17.5H17"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="1.5"
      />
      <circle className="fill-primary" cx="12" cy="6" r="3.5" />
      <circle cx="6.5" cy="17.5" fill="currentColor" r="2.5" />
      <circle cx="17.5" cy="17.5" fill="currentColor" r="2.5" />
    </svg>
  );
}

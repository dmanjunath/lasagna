export function DemoBanner() {
  return (
    <div
      style={{ zIndex: 100 }}
      className="fixed top-0 left-0 right-0 flex items-center justify-center gap-3 bg-[rgb(var(--color-accent))] px-4 py-2 text-sm font-medium text-[rgb(9,9,16)]"
    >
      <span>You're exploring a read-only demo.</span>
      <a
        href="https://app.lasagnafi.com/login"
        className="underline font-semibold"
      >
        Sign up to get started →
      </a>
    </div>
  );
}

export default function JoinedCard({
  position,
  alreadyIn,
}: {
  position: number;
  alreadyIn: boolean;
}) {
  return (
    <div className="wl-done wl-rise">
      <div className="wl-check" aria-hidden>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M3.5 8.4 6.6 11.5 12.5 4.9"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h2>{alreadyIn ? "you're already on the list" : "you're in."}</h2>
      <p>
        you&rsquo;re <b>#{position}</b> in line — we&rsquo;ll email you the moment invites
        open, and we&rsquo;ll ask what you want us to build first.
      </p>
    </div>
  );
}

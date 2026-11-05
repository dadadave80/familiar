export function Pet({
  sleeping = false,
  accessory = "",
  className = "",
}: {
  sleeping?: boolean;
  accessory?: string;
  className?: string;
}) {
  return (
    <svg
      className={`pet ${className}`}
      viewBox="0 0 110 100"
      role="img"
      aria-label={
        sleeping ? "Your companion, asleep" : "A small amber companion"
      }
    >
      <ellipse cx="55" cy="87" rx="30" ry="6" fill="#503729" opacity=".12" />
      <g className="pet-body">
        <path
          d="M25 75C17 63 22 39 31 33L36 17Q41 12 46 30L61 29Q75 12 78 22L78 38C91 51 90 73 79 80Q53 94 25 75Z"
          fill="#F2A541"
          stroke="#503729"
          strokeWidth="2.5"
        />
        <ellipse cx="39" cy="66" rx="7" ry="4" fill="#E8865B" opacity=".65" />
        <ellipse cx="75" cy="66" rx="7" ry="4" fill="#E8865B" opacity=".65" />
        {sleeping ? (
          <path
            d="M37 56q5 5 10 0m17 0q5 5 10 0"
            fill="none"
            stroke="#33261F"
            strokeWidth="3"
            strokeLinecap="round"
          />
        ) : (
          <g fill="#33261F">
            <ellipse cx="42" cy="56" rx="3" ry="4" />
            <ellipse cx="69" cy="56" rx="3" ry="4" />
            <circle cx="43" cy="55" r=".9" fill="#FFF9EF" />
            <circle cx="70" cy="55" r=".9" fill="#FFF9EF" />
          </g>
        )}
        <path
          d="M51 68q5 6 10 0"
          fill="none"
          stroke="#503729"
          strokeWidth="2"
          strokeLinecap="round"
        />
        {accessory === "scarf" && (
          <path
            d="M28 74q25 13 53-2l-3 10-20 2-5 12-10-3 4-10-17-2Z"
            fill="#2E6F6A"
          />
        )}
        {accessory === "hat" && (
          <g fill="#5B4E8A">
            <path d="M34 32 55 5l20 27Z" />
            <ellipse cx="55" cy="31" rx="28" ry="5" />
          </g>
        )}
      </g>
    </svg>
  );
}

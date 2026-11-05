const paths = {
  heart:
    "M12 20S3 14.5 3 8.5a4.5 4.5 0 0 1 9-1 4.5 4.5 0 0 1 9 1C21 14.5 12 20 12 20Z",
  leaf: "M19 4C9 3 3 7 5 14c2 7 12 5 14-10ZM5 20l9-10",
  bread: "M5 9C0 4 8 2 12 4c4-2 12 0 7 5v10H5ZM9 7v4m6-4v4",
  moon: "M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z",
  bag: "M5 8h14l2 12H3L5 8Zm3 0V6a4 4 0 0 1 8 0v2",
  shop: "M4 10v10h16V10M3 4h18l1 6c-2 3-4 0-4 0-2 3-4 0-4 0-2 3-4 0-4 0-2 3-4 0-4 0-2 3-4 0-4 0l1-6Zm6 16v-6h6v6",
  home: "m3 11 9-8 9 8M5 10v11h14V10m-10 11v-7h6v7",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  refresh: "M20 8a8 8 0 1 0 0 8m0-13v5h-5",
  sound: "M4 10h4l5-5v14l-5-5H4v-4Zm13-2a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
  mute: "M4 10h4l5-5v14l-5-5H4v-4Zm13-1 5 6m0-6-5 6",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  link: "M10 14 14 10M8 15l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0",
  check: "m5 12 4 4L20 5",
  spark: "m12 2 2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6L12 2Z",
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

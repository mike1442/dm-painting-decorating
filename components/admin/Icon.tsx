const paths = {
  quote: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  invoice: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3",
  diary: "M4 6h16v15H4zM4 10h16M8 3v5M16 3v5",
  settings:
    "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.5 7.5 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 1.7-1l2.4 1 2-3.4z",
  plus: "M12 5v14M5 12h14",
  back: "M15 5l-7 7 7 7",
  next: "M9 5l7 7-7 7",
  print: "M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  device: "M7 2h10v20H7zM11 18h2",
  download: "M12 3v12M7 10l5 5 5-5M5 21h14",
  upload: "M12 21V9M7 14l5-5 5 5M5 3h14",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  alert: "M12 8v5M12 16.5v.5M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  close: "M6 6l12 12M18 6 6 18",
  pound: "M16 6.5A4 4 0 0 0 9 9v9M6 13h7M6 18h11",
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="adm-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

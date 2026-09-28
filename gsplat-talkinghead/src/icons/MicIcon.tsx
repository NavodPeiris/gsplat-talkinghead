const SvgComponent = ({ size = 24 }: { size?: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    aria-hidden="true"
  >
    <path d="M12 19v3M19 10v2a7 7 0 0 1-14 0v-2" />
    <rect width={6} height={13} x={9} y={2} rx={3} />
  </svg>
)
export { SvgComponent as MicIcon };

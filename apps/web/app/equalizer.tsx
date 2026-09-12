/** The three bouncing bars that mark whatever is playing. `.eq` in globals.css animates them,
 * and they take their colour from `currentColor`. */
export function Equalizer({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`eq flex items-end ${className}`}>
      <span />
      <span />
      <span />
    </span>
  );
}

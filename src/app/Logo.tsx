/** The Plastic logo (the product mark, not a UI icon). */
import logoUrl from './logo.svg';

export function Logo({ size, className }: { size: number; className?: string }) {
  return <img src={logoUrl} width={size} height={size} alt="" aria-hidden="true" draggable={false} className={className} />;
}

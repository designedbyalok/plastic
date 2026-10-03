import * as Primitive from '@radix-ui/react-dropdown-menu';
import type { ComponentProps } from 'react';

export { Primitive as Menu };
/** Portal outside panel scroll containers; let Radix handle placement, focus and dismissal. */
export function MenuContent({ className = '', align = 'end', ...props }: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal><Primitive.Content sideOffset={5} collisionPadding={8} hideWhenDetached {...props} align={align}
    className={`insp-menu plastic-menu-portal ${className}`} data-plastic-menu="" /></Primitive.Portal>;
}

import * as Area from '@radix-ui/react-scroll-area';
import type { ComponentProps, Ref } from 'react';

/** Native scrolling with a transient overlay thumb; no reserved scrollbar gutter. */
export function ScrollArea({ children, className = '', viewportRef, viewportClassName = '', ...props }: ComponentProps<typeof Area.Root> & {
  viewportRef?: Ref<HTMLDivElement>;
  viewportClassName?: string;
}) {
  return (
    <Area.Root {...props} className={`ui-scroll-area ${className}`} type="scroll" scrollHideDelay={650}>
      <Area.Viewport ref={viewportRef} className={`ui-scroll-viewport ${viewportClassName}`}>
        {children}
      </Area.Viewport>
      <Area.Scrollbar orientation="vertical" className="ui-scrollbar"><Area.Thumb className="ui-scroll-thumb" /></Area.Scrollbar>
      <Area.Scrollbar orientation="horizontal" className="ui-scrollbar"><Area.Thumb className="ui-scroll-thumb" /></Area.Scrollbar>
      <Area.Corner />
    </Area.Root>
  );
}

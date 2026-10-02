import * as Primitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { ReactNode } from 'react';

interface SelectProps {
  value: string;
  onChange(value: string): void;
  options: readonly (string | { value: string; label: string })[];
  placeholder?: string;
  ariaLabel: string;
  mono?: boolean;
  prefix?: ReactNode;
}

// Encoding every value also makes an empty (inherit/reset) option selectable in Radix.
const encode = (value: string) => `plastic-value:${value}`;
export function Select({ value, onChange, options, placeholder, ariaLabel, mono, prefix }: SelectProps) {
  const choices = [
    ...new Map(
      options.map((option) => {
        const item = typeof option === 'string' ? { value: option, label: option } : option;
        return [item.value, item] as const;
      }),
    ).values(),
  ];
  if (placeholder !== undefined && !choices.some((item) => item.value === ''))
    choices.unshift({ value: '', label: placeholder });
  // Imported/custom values remain visible and selectable rather than being silently coerced.
  if (value && !choices.some((item) => item.value === value)) choices.unshift({ value, label: value });
  const selected = choices.find((item) => item.value === value);
  return (
    <Primitive.Root
      value={selected ? encode(value) : ''}
      onValueChange={(next) => onChange(next.slice('plastic-value:'.length))}
    >
      <span className="insp-select-wrap">
        <Primitive.Trigger
          aria-label={ariaLabel}
          className={`insp-select${mono ? ' is-mono' : ''}${prefix ? ' has-prefix' : ''}${value === '' ? ' is-placeholder' : ''}`}
        >
          <Primitive.Value>{selected?.label ?? placeholder ?? 'Select'}</Primitive.Value>
          <Primitive.Icon asChild>
            <ChevronDown size={12} strokeWidth={1.5} className="insp-select-chevron" />
          </Primitive.Icon>
        </Primitive.Trigger>
        {prefix && <span className="insp-prefix">{prefix}</span>}
      </span>
      <Primitive.Portal>
        <Primitive.Content
          className={`plastic-select-menu${mono ? ' is-mono' : ''}`}
          position="popper"
          sideOffset={5}
          align="start"
          collisionPadding={8}
          aria-label={`${ariaLabel} options`}
          data-plastic-select=""
        >
          <Primitive.ScrollUpButton className="plastic-select-scroll">
            <ChevronUp size={12} />
          </Primitive.ScrollUpButton>
          <Primitive.Viewport className="plastic-select-viewport">
            {choices.map((item) => (
              <Primitive.Item
                key={item.value}
                value={encode(item.value)}
                textValue={item.label}
                className="plastic-select-option"
              >
                <Primitive.ItemText>{item.label}</Primitive.ItemText>
                <Primitive.ItemIndicator className="plastic-select-check">
                  <Check size={12} strokeWidth={1.75} />
                </Primitive.ItemIndicator>
              </Primitive.Item>
            ))}
          </Primitive.Viewport>
          <Primitive.ScrollDownButton className="plastic-select-scroll">
            <ChevronDown size={12} />
          </Primitive.ScrollDownButton>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}

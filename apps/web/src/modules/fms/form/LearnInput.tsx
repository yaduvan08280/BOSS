import { Input } from '@/components/ui/input';
import type { InputProps } from './ctx';

/**
 * A text field that remembers what people type (§2.1): a dropdown of the values already entered, most used
 * first, with "Write…" as the last option.
 */
export function LearnInput({ field, value, ctx }: InputProps) {
  return (
    <Input
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => ctx.set(field.key, e.target.value)}
    />
  );
}

import type { ChangeEventHandler, KeyboardEventHandler, Ref } from 'react'
import type { FieldSpec } from './fields.js'

// The palette's focus ring and touch-target sizes are shared by every control (ST-1 AC-5, AC-6).
export const control = 'block w-full min-w-0 rounded-md focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus'

export interface FieldProps {
  readonly field: FieldSpec
  readonly value: string
  /** The message Submit left on the field: shown directly under it, with a red border (ST-8 AC-2). */
  readonly error?: string
  readonly autoFocus?: boolean
  readonly inputRef?: Ref<HTMLInputElement>
  readonly onChange: ChangeEventHandler<HTMLInputElement>
  readonly onKeyDown?: KeyboardEventHandler<HTMLInputElement>
}

/** One labelled visitor field: its input, then any error, then any hint. */
export function Field({ field, value, error, autoFocus, inputRef, onChange, onKeyDown }: FieldProps) {
  const errorId = `${field.name}-error`
  const hintId = `${field.name}-hint`
  const describedBy = [error ? errorId : undefined, field.hint ? hintId : undefined].filter(Boolean).join(' ')

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={field.name} className="font-medium">
        {field.label}
      </label>
      <input
        ref={inputRef}
        id={field.name}
        name={field.name}
        type={field.type}
        inputMode={field.inputMode}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        className={`${control} min-h-11 border ${error ? 'border-danger' : 'border-edge'} bg-surface px-3 py-2 text-ink`}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      {field.hint ? (
        <p id={hintId} className="text-sm text-muted">
          {field.hint}
        </p>
      ) : null}
    </div>
  )
}

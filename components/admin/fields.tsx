"use client";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { parseAmount } from "@/lib/admin/money";
import { textList } from "@/lib/admin/normalise";
import type { Address, Customer } from "@/lib/admin/types";

/** Props that name a control by its visible label and describe it by its hint. */
export type ControlProps = { id: string; "aria-labelledby": string; "aria-describedby"?: string };

type FieldProps = { label: string; hint?: string; className?: string; children: (control: ControlProps) => React.ReactNode };

// The wrapping label keeps click-to-focus, but its text content also contains
// hints, currency affixes, option text and textarea values. aria-labelledby
// keeps the accessible name exactly the visible label for screen readers and tests.
export function Field({ label, hint, className, children }: FieldProps) {
  const id = useId();
  const control: ControlProps = { id: `${id}control`, "aria-labelledby": `${id}label`, ...(hint ? { "aria-describedby": `${id}hint` } : {}) };
  return (
    <label className={"adm-field" + (className ? ` ${className}` : "")} htmlFor={control.id}>
      <span className="adm-field-label" id={`${id}label`}>{label}</span>
      {children(control)}
      {hint && <small className="adm-field-hint" id={`${id}hint`}>{hint}</small>}
    </label>
  );
}

type TextFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">;

export function TextField({ label, value, onChange, hint, className, ...input }: TextFieldProps) {
  return (
    <Field label={label} hint={hint} className={className}>
      {control => <input {...input} {...control} className="adm-input" value={value} onChange={e => onChange(e.target.value)} />}
    </Field>
  );
}

function useAutoHeight(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return ref;
}

type TextAreaProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  placeholder?: string;
  rows?: number;
  className?: string;
};

export function TextArea({ label, value, onChange, hint, placeholder, rows = 3, className }: TextAreaProps) {
  const ref = useAutoHeight(value);
  return (
    <Field label={label} hint={hint} className={className}>
      {control => <textarea {...control} ref={ref} className="adm-input adm-textarea" rows={rows} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />}
    </Field>
  );
}

/** A textarea edited as text but stored as a list, one entry per line. */
export function LinesField({ label, value, onChange, hint, placeholder }: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  hint?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value.join("\n");
  const ref = useAutoHeight(shown);
  return (
    <Field label={label} hint={hint}>
      {control => <textarea
        {...control}
        ref={ref}
        className="adm-input adm-textarea"
        rows={4}
        value={shown}
        placeholder={placeholder}
        onFocus={() => setDraft(value.join("\n"))}
        onChange={e => {
          setDraft(e.target.value);
          onChange(textList(e.target.value, 100));
        }}
        onBlur={() => setDraft(null)}
      />}
    </Field>
  );
}

/** Decimal input that keeps exactly what was typed while focused (e.g. "12."). */
export function NumberField({ label, value, onChange, prefix, suffix, decimals, placeholder, hint, className }: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  placeholder?: string;
  hint?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const formatted = value === 0 && placeholder ? "" : decimals !== undefined ? value.toFixed(decimals) : String(value);
  return (
    <Field label={label} hint={hint} className={className}>
      {control => <span className="adm-affix">
        {prefix && <span className="adm-affix-text" id={`${control.id}prefix`}>{prefix}</span>}
        <input
          {...control}
          // Units such as £, % or days describe the value without renaming the field.
          aria-describedby={[control["aria-describedby"], prefix && `${control.id}prefix`, suffix && `${control.id}suffix`].filter(Boolean).join(" ") || undefined}
          className="adm-input"
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          value={draft ?? formatted}
          onFocus={e => {
            setDraft(formatted);
            e.target.select();
          }}
          onChange={e => {
            setDraft(e.target.value);
            onChange(parseAmount(e.target.value) ?? 0);
          }}
          onBlur={() => setDraft(null)}
        />
        {suffix && <span className="adm-affix-text" id={`${control.id}suffix`}>{suffix}</span>}
      </span>}
    </Field>
  );
}

export function DateField({ label, value, onChange, hint, className }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      {control => <input {...control} type="date" className="adm-input" value={value} onChange={e => e.target.value && onChange(e.target.value)} />}
    </Field>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange, hint, className }: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
  hint?: string;
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      {control => <select {...control} className="adm-input adm-select" value={value} onChange={e => onChange(e.target.value as T)}>
        {options.map(([option, text]) => (
          <option key={option} value={option}>
            {text}
          </option>
        ))}
      </select>}
    </Field>
  );
}

export function Toggle({ label, hint, checked, onChange }: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <label className="adm-toggle">
      <span>
        <strong id={`${id}label`}>{label}</strong>
        {hint && <small id={`${id}hint`}>{hint}</small>}
      </span>
      <input type="checkbox" role="switch" aria-labelledby={`${id}label`} aria-describedby={hint ? `${id}hint` : undefined} checked={checked} onChange={e => onChange(e.target.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}

export function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <div className="adm-segmented" role="radiogroup" aria-label={label}>
      {options.map(([option, text]) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          className={value === option ? "is-on" : undefined}
          onClick={() => onChange(option)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function AddressFields({ value, onChange }: { value: Address; onChange: (value: Address) => void }) {
  const set = (key: keyof Address) => (text: string) => onChange({ ...value, [key]: text });
  return (
    <div className="adm-grid">
      <TextField label="Address" className="adm-span-2" value={value.line1} onChange={set("line1")} autoComplete="off" placeholder="House number and street" />
      <TextField label="Address line 2" className="adm-span-2" value={value.line2} onChange={set("line2")} autoComplete="off" placeholder="Optional" />
      <TextField label="Town" value={value.town} onChange={set("town")} autoComplete="off" />
      <TextField label="Postcode" value={value.postcode} onChange={text => set("postcode")(text.toUpperCase())} autoComplete="off" />
    </div>
  );
}

export function CustomerFields({ value, onChange }: { value: Customer; onChange: (value: Customer) => void }) {
  return (
    <>
      <div className="adm-grid">
        <TextField label="Customer name" className="adm-span-2" value={value.name} onChange={name => onChange({ ...value, name })} autoComplete="off" placeholder="e.g. Mrs J. Smith" />
        <TextField label="Email" type="email" value={value.email} onChange={email => onChange({ ...value, email })} autoComplete="off" />
        <TextField label="Phone" type="tel" value={value.phone} onChange={phone => onChange({ ...value, phone })} autoComplete="off" />
      </div>
      <AddressFields value={value.address} onChange={address => onChange({ ...value, address })} />
    </>
  );
}

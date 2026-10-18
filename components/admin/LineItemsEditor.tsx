"use client";
import { NumberField, TextArea, TextField } from "./fields";
import { Icon } from "./Icon";
import { newLineItem } from "@/lib/admin/factories";
import { formatPence, lineTotalPence, sumLinesPence } from "@/lib/admin/money";
import type { LineItem } from "@/lib/admin/types";

export const UNIT_SUGGESTIONS = ["room", "day", "hour", "m²", "m", "item", "door", "window", "wall", "ceiling", "coat", "allowance"];

export function UnitSuggestions() {
  return (
    <datalist id="adm-units">
      {UNIT_SUGGESTIONS.map(unit => (
        <option key={unit} value={unit} />
      ))}
    </datalist>
  );
}

export function LineItemsEditor({ items, onChange, addLabel, placeholder, subtotalLabel }: {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  addLabel: string;
  placeholder: string;
  subtotalLabel: string;
}) {
  const update = (id: string, change: Partial<LineItem>) => onChange(items.map(item => (item.id === id ? { ...item, ...change } : item)));
  const move = (index: number, by: number) => {
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    onChange(next);
  };

  return (
    <div className="adm-lines">
      {items.map((item, index) => (
        <div className="adm-line" key={item.id} role="group" aria-label={`Line ${index + 1}`}>
          <TextArea
            label={`Line ${index + 1}`}
            value={item.description}
            onChange={description => update(item.id, { description })}
            placeholder={placeholder}
            rows={2}
          />
          <div className="adm-line-numbers">
            <NumberField label="Qty" value={item.quantity} onChange={quantity => update(item.id, { quantity })} />
            <TextField label="Unit" value={item.unit} onChange={unit => update(item.id, { unit })} list="adm-units" placeholder="e.g. room" autoComplete="off" />
            <NumberField label="Price each" prefix="£" decimals={2} placeholder="0.00" value={item.unitPrice} onChange={unitPrice => update(item.id, { unitPrice })} />
          </div>
          <div className="adm-line-foot">
            <div className="adm-line-tools">
              <button type="button" className="adm-icon-btn" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move line ${index + 1} up`}>
                <Icon name="up" size={18} />
              </button>
              <button type="button" className="adm-icon-btn" onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label={`Move line ${index + 1} down`}>
                <Icon name="down" size={18} />
              </button>
              <button type="button" className="adm-icon-btn adm-danger" onClick={() => onChange(items.filter(i => i.id !== item.id))} aria-label={`Remove line ${index + 1}`}>
                <Icon name="trash" size={18} />
              </button>
            </div>
            <strong className={item.unitPrice ? undefined : "adm-unpriced"}>
              {item.unitPrice ? formatPence(lineTotalPence(item)) : "No price yet"}
            </strong>
          </div>
        </div>
      ))}
      <div className="adm-lines-foot">
        <button type="button" className="adm-btn adm-btn-ghost" onClick={() => onChange([...items, newLineItem()])}>
          <Icon name="plus" size={18} /> {addLabel}
        </button>
        {items.length > 0 && (
          <span>
            {subtotalLabel} <strong>{formatPence(sumLinesPence(items))}</strong>
          </span>
        )}
      </div>
    </div>
  );
}

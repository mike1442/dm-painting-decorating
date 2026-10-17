"use client";
import { NumberField, Segmented, Toggle } from "./fields";
import { formatPence } from "@/lib/admin/money";
import type { DepositSetting, VatSetting } from "@/lib/admin/types";

export function VatControls({ vat, onChange, vatNumber }: { vat: VatSetting; onChange: (vat: VatSetting) => void; vatNumber: string }) {
  return (
    <div className="adm-stack">
      <Toggle
        label="Charge VAT"
        hint="Only when D&M is VAT registered. Never added automatically."
        checked={vat.enabled}
        onChange={enabled => onChange({ ...vat, enabled })}
      />
      {vat.enabled && (
        <>
          <NumberField label="VAT rate" suffix="%" value={vat.rate} onChange={rate => onChange({ ...vat, rate: Math.min(Math.max(rate, 0), 100) })} className="adm-narrow" />
          {!vatNumber.trim() && (
            <p className="adm-inline-warn">
              Add your VAT registration number in <a href="/admin/settings">Settings</a>. It must appear on VAT invoices.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function DepositControls({ deposit, onChange, depositPence }: {
  deposit: DepositSetting;
  onChange: (deposit: DepositSetting) => void;
  depositPence: number;
}) {
  return (
    <div className="adm-stack">
      <Segmented
        label="Deposit"
        value={deposit.type}
        options={[
          ["none", "No deposit"],
          ["percent", "Percentage"],
          ["fixed", "Fixed amount"],
        ]}
        onChange={type => onChange(type === "none" ? { type, value: 0 } : { type, value: deposit.type === type ? deposit.value : 0 })}
      />
      {deposit.type !== "none" && (
        <div className="adm-row-end">
          <NumberField
            label={deposit.type === "percent" ? "Deposit percentage" : "Deposit amount"}
            prefix={deposit.type === "fixed" ? "£" : undefined}
            suffix={deposit.type === "percent" ? "%" : undefined}
            decimals={deposit.type === "fixed" ? 2 : undefined}
            value={deposit.value}
            onChange={value => onChange({ ...deposit, value: Math.max(value, 0) })}
            className="adm-narrow"
          />
          <span className="adm-muted">= {formatPence(depositPence)}</span>
        </div>
      )}
    </div>
  );
}

export function TotalsSummary({ rows }: { rows: [string, number, ("grand" | "muted")?][] }) {
  return (
    <dl className="adm-totals">
      {rows.map(([label, pence, tone]) => (
        <div key={label} className={tone ? `adm-totals-${tone}` : undefined}>
          <dt>{label}</dt>
          <dd>{formatPence(pence)}</dd>
        </div>
      ))}
    </dl>
  );
}

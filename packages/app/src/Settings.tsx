import { useState } from "react";

export interface VendorKeys {
  mouser: { apiKey: string };
  digikey: { clientId: string; clientSecret: string };
}

const STORAGE_KEY = "ahs-vendor-keys";

export function loadVendorKeys(): VendorKeys {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as VendorKeys;
  } catch {
    // fall through to defaults
  }
  return { mouser: { apiKey: "" }, digikey: { clientId: "", clientSecret: "" } };
}

export function SettingsDialog({
  initial,
  onSave,
  onClose,
}: {
  initial: VendorKeys;
  onSave: (keys: VendorKeys) => void;
  onClose: () => void;
}) {
  const [mouserKey, setMouserKey] = useState(initial.mouser.apiKey);
  const [dkId, setDkId] = useState(initial.digikey.clientId);
  const [dkSecret, setDkSecret] = useState(initial.digikey.clientSecret);

  const save = () => {
    const keys: VendorKeys = {
      mouser: { apiKey: mouserKey.trim() },
      digikey: { clientId: dkId.trim(), clientSecret: dkSecret.trim() },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
    onSave(keys);
    onClose();
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Distributor API keys</h2>
        <p className="dialog-hint">
          Keys stay in this browser (localStorage) and are only sent to your local dev server to
          look parts up. LCSC needs no key.
        </p>
        <label>
          Mouser API key
          <input
            type="password"
            value={mouserKey}
            onChange={(e) => setMouserKey(e.target.value)}
            placeholder="from mouser.com/api-hub"
            autoComplete="off"
          />
        </label>
        <label>
          Digi-Key client ID
          <input
            type="password"
            value={dkId}
            onChange={(e) => setDkId(e.target.value)}
            placeholder="from developer.digikey.com"
            autoComplete="off"
          />
        </label>
        <label>
          Digi-Key client secret
          <input
            type="password"
            value={dkSecret}
            onChange={(e) => setDkSecret(e.target.value)}
            autoComplete="off"
          />
        </label>
        <div className="dialog-actions">
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { getRelayerBaseUrl, setRelayerBaseUrl } from '../api/relayerClient';

export function RelayerBar() {
  const [url, setUrl] = useState(() => getRelayerBaseUrl());

  return (
    <details className="ab-settings-wrap">
      <summary className="ab-settings">Settings</summary>
      <div className="ab-settings-panel">
        <label htmlFor="relayer-url">Relayer base URL</label>
        <div className="ab-settings-row">
          <input
            id="relayer-url"
            name="relayer-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://127.0.0.1:8787"
            autoComplete="url"
          />
          <button
            type="button"
            onClick={() => {
              setRelayerBaseUrl(url.trim() || getRelayerBaseUrl());
              window.location.reload();
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </details>
  );
}

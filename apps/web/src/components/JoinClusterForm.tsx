import { useState } from 'preact/hooks';
import { parseJoinCode } from '../lib/cluster-invite';
import { Button, Input, Spinner } from './ui';

type Props = {
  busy?: boolean;
  submitLabel?: string;
  cancelLabel?: string;
  onCancel?: () => void;
  onSubmit: (body: { token: string; leader_url: string; name?: string }) => void | Promise<void>;
};

export function JoinClusterForm({
  busy,
  submitLabel = 'Rejoindre',
  cancelLabel = 'Retour',
  onCancel,
  onSubmit,
}: Props) {
  const [code, setCode] = useState('');
  const [leaderUrl, setLeaderUrl] = useState('');
  const [parsedUrl, setParsedUrl] = useState('');
  const [name, setName] = useState('');

  function onCodeInput(raw: string) {
    setCode(raw);
    const parsed = parseJoinCode(raw);
    if (!parsed) return;
    if (!leaderUrl.trim() || leaderUrl.trim() === parsedUrl) {
      setLeaderUrl(parsed.leader_url);
    }
    setParsedUrl(parsed.leader_url);
  }

  function parsedToken(): string | null {
    const parsed = parseJoinCode(code) || parseJoinCode(`${code.trim()}@${leaderUrl.trim()}`);
    if (parsed?.token) return parsed.token;
    const t = code.trim();
    if (/^dfjoin_[A-Za-z0-9]+$/i.test(t)) return t;
    return null;
  }

  const token = parsedToken();
  const url = leaderUrl.trim().replace(/\/+$/, '');
  const urlOk = /^https?:\/\//i.test(url);
  const canSubmit = !!token && urlOk && !busy;

  return (
    <form
      class="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!token || !urlOk) return;
        onSubmit({
          token,
          leader_url: url,
          name: name.trim() || undefined,
        });
      }}
    >
      <Input
        label="Code d’invitation"
        value={code}
        placeholder="dfjoin_…"
        required
        autocomplete="off"
        onInput={(e) => onCodeInput((e.target as HTMLInputElement).value)}
        hint="Le jeton copié sur le leader (Cluster → Invitation)."
      />
      <Input
        label="URL du leader"
        value={leaderUrl}
        placeholder="https://"
        required
        onInput={(e) => setLeaderUrl((e.target as HTMLInputElement).value)}
        hint="Adresse joignable depuis cette machine. Pas collée dans le jeton — tu la choisis ici."
      />
      <Input
        label="Nom de ce nœud"
        value={name}
        placeholder="nom du nœud"
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        hint="Optionnel — sinon le nom de la machine."
      />
      <div class="flex gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
        )}
        <Button type="submit" class="flex-1" disabled={!canSubmit}>
          {busy ? <Spinner /> : null}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

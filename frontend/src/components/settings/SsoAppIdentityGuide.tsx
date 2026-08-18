import { Check, Copy, Sparkles } from 'lucide-preact';
import { useState } from 'preact/hooks';
import type { InstanceSsoSettings } from '../../lib/domain-api';
import { ssoCursorPrompt, ssoIssuerUrl } from '../../lib/sso-app-identity';
import { Modal } from '../ui/Modal';

type SsoAppIdentityGuideProps = {
    sso: InstanceSsoSettings;
    appsWildcardDomain?: string | null;
};

async function copyText(value: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(value);
        return true;
    } catch {
        return false;
    }
}

export function SsoAppIdentityGuide({ sso, appsWildcardDomain = null }: SsoAppIdentityGuideProps) {
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const prompt = ssoCursorPrompt(sso, { appsWildcardDomain });
    const issuer = ssoIssuerUrl(sso);

    const copyPrompt = () => {
        void copyText(prompt).then((ok) => {
            if (ok) {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
            }
        });
    };

    return (
        <div class="grid gap-3 rounded-xl border border-base-300/70 p-3">
            <div>
                <p class="text-sm font-semibold">SSO dans tes apps</p>
                <p class="text-xs text-base-content/55">
                    Le login actuel reste. Chaque app peut proposer « Continuer avec Pocket ID ».
                    Une fois qu’un utilisateur a lié le SSO, c’est sa façon de se connecter — les autres gardent email / mot de passe.
                </p>
            </div>
            <p class="text-xs text-base-content/55">
                Issuer :{' '}
                <span class="font-mono break-all">{issuer ?? 'domaine instance manquant'}</span>
            </p>
            <button class="btn btn-outline btn-sm w-fit rounded-xl" type="button" onClick={() => setOpen(true)}>
                <Sparkles class="size-3.5" aria-hidden />
                Prompt Cursor
            </button>
            <Modal
                open={open}
                title="Prompt Cursor pour tes apps"
                size="xl"
                onClose={() => setOpen(false)}
                footer={(
                    <>
                        <button class="btn btn-ghost btn-sm rounded-xl" type="button" onClick={() => setOpen(false)}>
                            Fermer
                        </button>
                        <button class="btn btn-primary btn-sm rounded-xl" type="button" onClick={copyPrompt}>
                            {copied ? <Check class="size-3.5" aria-hidden /> : <Copy class="size-3.5" aria-hidden />}
                            {copied ? 'Copié' : 'Copier le prompt'}
                        </button>
                    </>
                )}
            >
                <p class="text-sm text-base-content/65">
                    Colle ce prompt dans Cursor, dans le repo de l’app. Il ajoute le bouton SSO sans retirer le login existant.
                </p>
                <pre class="max-h-96 overflow-auto rounded-xl bg-base-200/70 p-3 text-xs leading-relaxed whitespace-pre-wrap">
                    <code>{prompt}</code>
                </pre>
            </Modal>
        </div>
    );
}

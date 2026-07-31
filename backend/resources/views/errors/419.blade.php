@if (config('devforge.enabled'))
    @extends('layouts.devforge-auth')

    @section('content')
        <div class="devforge-auth-shell">
            <div class="devforge-auth-panel devforge-auth-panel-wide">
                <header class="devforge-auth-brand">
                    <img
                        src="{{ asset('brand/logo.png') }}"
                        alt=""
                        class="devforge-auth-logo"
                        width="56"
                        height="56"
                        aria-hidden="true"
                    />
                    <div>
                        <p class="devforge-auth-hero-code">419</p>
                        <h1 class="devforge-auth-heading">Session expirée</h1>
                        <p class="devforge-auth-subtitle">
                            Le jeton de sécurité n’a pas pu être validé. Cela arrive souvent quand le FQDN
                            ou les cookies ne correspondent pas à l’URL utilisée.
                        </p>
                    </div>
                </header>

                <details class="devforge-auth-card devforge-auth-details">
                    <summary>Reverse proxy ou accès sur le port 8080 ?</summary>
                    <ul>
                        <li>
                            Définissez le FQDN dans <strong>Settings → FQDN</strong> avec le même domaine que votre URL
                            (ex. <code class="devforge-auth-code">http://votre-domaine.tld</code>).
                        </li>
                        <li>
                            Accédez toujours via la même URL, y compris le port si vous utilisez
                            <code class="devforge-auth-code">:8080</code>.
                        </li>
                        <li>
                            Si vous êtes en HTTP, ajoutez dans le <code class="devforge-auth-code">.env</code> :
                            <code class="devforge-auth-code">SESSION_SECURE_COOKIE=false</code>
                        </li>
                        <li>Videz les cookies du site, puis reconnectez-vous.</li>
                    </ul>
                </details>

                <div class="devforge-auth-actions" style="margin-top: 1.25rem;">
                    <a href="/login" class="devforge-auth-primary">
                        Retour à la connexion
                    </a>
                </div>
            </div>
        </div>
    @endsection
@else
    @extends('layouts.base')
    <div class="flex flex-col items-center justify-center h-full">
        <div>
            <p class="font-mono font-semibold text-7xl dark:text-warning">419</p>
            <h1 class="mt-4 font-bold tracking-tight dark:text-white">This page is definitely old, not like you!</h1>
            <p class="text-base leading-7 dark:text-neutral-300 text-black">Your session has expired. Please log in again to continue.
            </p>
            <details class="mt-6 text-sm dark:text-neutral-400 text-neutral-600">
                <summary class="cursor-pointer hover:dark:text-neutral-200 hover:text-neutral-800">Using a reverse proxy or Cloudflare Tunnel?</summary>
                <ul class="mt-2 ml-4 list-disc space-y-1">
                    <li>Set your domain in <strong>Settings &rarr; FQDN</strong> to match the URL you use to access Coolify.</li>
                    <li>Cloudflare users: disable <strong>Browser Integrity Check</strong> and <strong>Under Attack Mode</strong> for your Coolify domain, as these can interrupt login sessions.</li>
                    <li>If you can still access Coolify via <code>localhost</code>, log in there first to configure your FQDN.</li>
                </ul>
            </details>
            <div class="flex items-center mt-6 gap-x-2">
                <a href="/login">
                    <x-forms.button>Back to Login</x-forms.button>
                </a>
                <a target="_blank" class="text-xs" href="{{ config('constants.urls.contact') }}">Contact
                    support
                    <x-external-link />
                </a>
            </div>
        </div>
    </div>
@endif

@extends('layouts.devforge-auth')

@section('content')
    @php
        $emailValue = app()->environment('local') ? 'test@example.com' : old('email');
        $passwordValue = app()->environment('local') ? 'password' : '';
    @endphp

    <div class="devforge-auth-shell devforge-auth-shell-split">
        <aside class="devforge-auth-ecosystem" aria-labelledby="df-eco-title">
            <div
                class="devforge-auth-constellation"
                role="img"
                aria-label="DevForge au centre, relié à GitHub, MCP, clés d’équipe et agents IA"
            >
                <svg class="devforge-auth-eco-lines" viewBox="0 0 400 400" fill="none" aria-hidden="true">
                    <defs>
                        <linearGradient id="df-eco-stroke" x1="200" y1="200" x2="200" y2="64" gradientUnits="userSpaceOnUse">
                            <stop stop-color="#fcd452" stop-opacity="0.55" />
                            <stop offset="1" stop-color="#fcd452" stop-opacity="0.08" />
                        </linearGradient>
                    </defs>
                    <circle cx="200" cy="200" r="118" stroke="#fcd452" stroke-opacity="0.08" />
                    <circle cx="200" cy="200" r="168" stroke="#ffffff" stroke-opacity="0.05" stroke-dasharray="3 10" />
                    <path d="M200 200 L200 64" stroke="url(#df-eco-stroke)" stroke-width="1.25" />
                    <path d="M200 200 L336 128" stroke="#fcd452" stroke-opacity="0.28" stroke-width="1.25" />
                    <path d="M200 200 L336 272" stroke="#fcd452" stroke-opacity="0.22" stroke-width="1.25" />
                    <path d="M200 200 L200 336" stroke="#fcd452" stroke-opacity="0.26" stroke-width="1.25" />
                    <path d="M200 200 L64 272" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1.15" stroke-dasharray="4 6" />
                </svg>

                <div class="devforge-auth-eco-hub">
                    <img src="/brand/logo.png" alt="" width="64" height="64" />
                    <span>DevForge</span>
                </div>

                <div class="devforge-auth-eco-node" style="--x: 50%; --y: 16%; --delay: 0s;">
                    <span class="devforge-auth-eco-icon" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
                            <path d="M9 18c-4.51 2-5-2-7-2" />
                        </svg>
                    </span>
                    <span class="devforge-auth-eco-label">GitHub</span>
                </div>

                <div class="devforge-auth-eco-node" style="--x: 84%; --y: 32%; --delay: 0.4s;">
                    <span class="devforge-auth-eco-icon" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 2v6" />
                            <path d="m8 8 4-6 4 6" />
                            <rect x="4" y="14" width="6" height="8" rx="1" />
                            <rect x="14" y="14" width="6" height="8" rx="1" />
                            <path d="M7 14v-2a5 5 0 0 1 10 0v2" />
                        </svg>
                    </span>
                    <span class="devforge-auth-eco-label">MCP</span>
                </div>

                <div class="devforge-auth-eco-node" style="--x: 84%; --y: 68%; --delay: 0.8s;">
                    <span class="devforge-auth-eco-icon" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="7.5" cy="15.5" r="5.5" />
                            <path d="m21 2-9.6 9.6" />
                            <path d="m15.5 7.5 3 3L22 7l-3-3" />
                        </svg>
                    </span>
                    <span class="devforge-auth-eco-label">Clés d’équipe</span>
                </div>

                <div class="devforge-auth-eco-node" style="--x: 50%; --y: 84%; --delay: 1.1s;">
                    <span class="devforge-auth-eco-icon" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 8V4H8" />
                            <rect width="16" height="12" x="4" y="8" rx="2" />
                            <path d="M2 14h2" />
                            <path d="M20 14h2" />
                            <path d="M15 13v2" />
                            <path d="M9 13v2" />
                        </svg>
                    </span>
                    <span class="devforge-auth-eco-label">Agents IA</span>
                </div>

                <div class="devforge-auth-eco-node is-soon" style="--x: 16%; --y: 68%; --delay: 1.5s;">
                    <span class="devforge-auth-eco-icon" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                            <rect width="7" height="7" x="3" y="3" rx="1" />
                            <rect width="7" height="7" x="14" y="3" rx="1" />
                            <rect width="7" height="7" x="14" y="14" rx="1" />
                            <rect width="7" height="7" x="3" y="14" rx="1" />
                        </svg>
                    </span>
                    <span class="devforge-auth-eco-label">Slack <small>bientôt</small></span>
                </div>
            </div>

            <p class="devforge-auth-eco-kicker">Écosystème d’apps connecté</p>
            <h2 class="devforge-auth-eco-title" id="df-eco-title">Laissez l’IA travailler dans vos outils</h2>
            <p class="devforge-auth-eco-lead">
                GitHub, MCP et clés d’équipe, reliés à un seul hub DevForge —
                plus besoin de copier-coller entre vos apps.
            </p>
        </aside>

        <div class="devforge-auth-panel">
            <header class="devforge-auth-brand">
                <img
                    src="/brand/logo.png"
                    alt=""
                    class="devforge-auth-logo"
                    width="56"
                    height="56"
                    aria-hidden="true"
                />
                <div>
                    <h1 class="devforge-auth-title">DevForge</h1>
                    <p class="devforge-auth-subtitle">
                        Connectez-vous pour accéder à votre espace d’administration.
                    </p>
                </div>
            </header>

            <div class="devforge-auth-card">
                @if (session('status'))
                    <div class="devforge-auth-alert devforge-auth-alert-success" role="status">
                        {{ session('status') }}
                    </div>
                @endif

                @if (session('error'))
                    <div class="devforge-auth-alert devforge-auth-alert-error" role="alert">
                        {{ session('error') }}
                    </div>
                @endif

                @if ($errors->any())
                    <div class="devforge-auth-alert devforge-auth-alert-error" role="alert">
                        @foreach ($errors->all() as $error)
                            <p>{{ $error }}</p>
                        @endforeach
                    </div>
                @endif

                @unless ($sso_hide_local_login ?? false)
                <form action="/login" method="POST" class="devforge-auth-form">
                    @csrf

                    <div class="devforge-auth-field">
                        <label class="devforge-auth-label" for="email">{{ __('input.email') }}</label>
                        <input
                            id="email"
                            class="devforge-auth-input"
                            type="email"
                            name="email"
                            value="{{ $emailValue }}"
                            autocomplete="email"
                            required
                            autofocus
                            placeholder="vous@exemple.com"
                        />
                    </div>

                    <div class="devforge-auth-field">
                        <label class="devforge-auth-label" for="password">{{ __('input.password') }}</label>
                        <div class="devforge-auth-password" data-password-field>
                            <input
                                id="password"
                                class="devforge-auth-input"
                                type="password"
                                name="password"
                                value="{{ $passwordValue }}"
                                autocomplete="current-password"
                                required
                                placeholder="••••••••"
                            />
                            <button
                                class="devforge-auth-peek"
                                type="button"
                                data-password-toggle
                                aria-label="Afficher le mot de passe"
                                aria-pressed="false"
                            >
                                <svg data-icon-show xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" />
                                    <path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6" />
                                </svg>
                                <svg data-icon-hide xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" hidden>
                                    <path d="M10.585 10.587a2 2 0 0 0 2.829 2.828" />
                                    <path d="M16.681 16.673a8.717 8.717 0 0 1 -4.681 1.327c-3.6 0 -6.6 -2 -9 -6c1.272 -2.12 2.712 -3.678 4.32 -4.674m2.86 -1.146a9.055 9.055 0 0 1 1.82 -.18c3.6 0 6.6 2 9 6c-.666 1.11 -1.379 2.067 -2.138 2.87" />
                                    <path d="M3 3l18 18" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    <div class="devforge-auth-row">
                        <a href="/forgot-password" class="devforge-auth-link">
                            {{ __('auth.forgot_password_link') }}
                        </a>
                    </div>

                    <button class="devforge-auth-primary devforge-auth-primary-block" type="submit">
                        {{ __('auth.login') }}
                    </button>
                </form>
                @endunless

                @if (! ($sso_hide_local_login ?? false))
                    @if ($is_registration_enabled)
                        <div class="devforge-auth-divider">
                            <span>Pas encore de compte ?</span>
                        </div>
                        <a href="/register" class="devforge-auth-secondary">
                            {{ __('auth.register_now') }}
                        </a>
                    @else
                        <p class="devforge-auth-muted devforge-auth-center">
                            {{ __('auth.registration_disabled') }}
                        </p>
                    @endif
                @endif

                @if ($enabled_oauth_providers->isNotEmpty())
                    @unless ($sso_hide_local_login ?? false)
                        <div class="devforge-auth-divider">
                            <span>ou continuer avec</span>
                        </div>
                    @endunless
                    <div class="devforge-auth-stack">
                        @foreach ($enabled_oauth_providers as $provider_setting)
                            <a
                                href="/auth/{{ $provider_setting->provider }}/redirect"
                                class="{{ $provider_setting->provider === 'pocketid' ? 'devforge-auth-primary' : 'devforge-auth-secondary' }}"
                            >
                                {{ __("auth.login.$provider_setting->provider") }}
                            </a>
                        @endforeach
                    </div>
                @endif
            </div>

            <details class="devforge-auth-card devforge-auth-details devforge-auth-token-hint">
                <summary>Token API DevForge</summary>
                <p class="devforge-auth-muted" style="margin: 0.75rem 0 0; line-height: 1.5;">
                    Les tokens API vous permettent d’accéder à DevForge depuis des outils externes, des scripts ou l’interface MCP.
                </p>
                <ol class="devforge-auth-muted" style="margin: 0.75rem 0 0; padding-inline-start: 1.25rem; line-height: 1.6; font-size: 0.875rem;">
                    <li>Connectez-vous avec vos identifiants ci-dessus</li>
                    <li>Accédez à <strong style="color: var(--df-content);">Sécurité → Tokens API</strong></li>
                    <li>Créez un nouveau token avec les permissions appropriées</li>
                    <li>Copiez le token généré (il ne sera affiché qu’une seule fois)</li>
                </ol>
                <p class="devforge-auth-muted" style="margin: 0.75rem 0 0; font-size: 0.8125rem;">
                    <strong style="color: var(--df-primary);">Note :</strong> Les tokens ne peuvent être générés qu’après authentification pour des raisons de sécurité.
                </p>
            </details>
        </div>
    </div>

    <script>
        document.querySelectorAll('[data-password-field]').forEach((field) => {
            const input = field.querySelector('input');
            const toggle = field.querySelector('[data-password-toggle]');
            const iconShow = field.querySelector('[data-icon-show]');
            const iconHide = field.querySelector('[data-icon-hide]');

            if (!input || !toggle) {
                return;
            }

            toggle.addEventListener('click', () => {
                const visible = input.type === 'text';
                input.type = visible ? 'password' : 'text';
                toggle.setAttribute('aria-pressed', visible ? 'false' : 'true');
                toggle.setAttribute('aria-label', visible ? 'Afficher le mot de passe' : 'Masquer le mot de passe');

                if (iconShow && iconHide) {
                    iconShow.hidden = !visible;
                    iconHide.hidden = visible;
                }
            });
        });
    </script>
@endsection

@extends('layouts.devforge-auth')

@section('content')
    @php
        $emailValue = app()->environment('local') ? 'test@example.com' : old('email');
        $passwordValue = app()->environment('local') ? 'password' : '';
    @endphp

    <div class="devforge-auth-shell">
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

                @if ($enabled_oauth_providers->isNotEmpty())
                    <div class="devforge-auth-divider">
                        <span>ou continuer avec</span>
                    </div>
                    <div class="devforge-auth-stack">
                        @foreach ($enabled_oauth_providers as $provider_setting)
                            <a
                                href="/auth/{{ $provider_setting->provider }}/redirect"
                                class="devforge-auth-secondary"
                            >
                                {{ __("auth.login.$provider_setting->provider") }}
                            </a>
                        @endforeach
                    </div>
                @endif
            </div>
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

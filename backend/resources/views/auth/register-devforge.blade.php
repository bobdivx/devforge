@extends('layouts.devforge-auth')

@section('content')
    @php
        $nameValue = old('name', '');
        $emailValue = old('email', '');
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
                        @if ($isFirstUser)
                            Créez le compte administrateur de cette instance.
                        @else
                            Créez votre compte pour accéder à DevForge.
                        @endif
                    </p>
                </div>
            </header>

            <div class="devforge-auth-card">
                @if ($isFirstUser)
                    <div class="devforge-auth-alert devforge-auth-alert-success" role="status">
                        Ce premier compte aura les droits administrateur.
                    </div>
                @endif

                @if ($errors->any())
                    <div class="devforge-auth-alert devforge-auth-alert-error" role="alert">
                        @foreach ($errors->all() as $error)
                            <p>{{ $error }}</p>
                        @endforeach
                    </div>
                @endif

                <form action="/register" method="POST" class="devforge-auth-form">
                    @csrf

                    <div class="devforge-auth-field">
                        <label class="devforge-auth-label" for="name">{{ __('input.name') }}</label>
                        <input
                            id="name"
                            class="devforge-auth-input"
                            type="text"
                            name="name"
                            value="{{ $nameValue }}"
                            autocomplete="name"
                            required
                            autofocus
                        />
                    </div>

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
                            placeholder="vous@exemple.com"
                        />
                    </div>

                    <div class="devforge-auth-field">
                        <label class="devforge-auth-label" for="password">{{ __('input.password') }}</label>
                        <input
                            id="password"
                            class="devforge-auth-input"
                            type="password"
                            name="password"
                            autocomplete="new-password"
                            required
                            placeholder="••••••••"
                        />
                    </div>

                    <div class="devforge-auth-field">
                        <label class="devforge-auth-label" for="password_confirmation">{{ __('input.password.again') }}</label>
                        <input
                            id="password_confirmation"
                            class="devforge-auth-input"
                            type="password"
                            name="password_confirmation"
                            autocomplete="new-password"
                            required
                            placeholder="••••••••"
                        />
                    </div>

                    <p class="devforge-auth-muted">
                        Minimum 8 caractères, avec une majuscule, une minuscule, un chiffre et un symbole.
                    </p>

                    <button class="devforge-auth-primary devforge-auth-primary-block" type="submit">
                        Créer le compte
                    </button>
                </form>

                @if (! $isFirstUser)
                    <div class="devforge-auth-divider">
                        <span>Déjà un compte ?</span>
                    </div>
                    <a href="{{ route('login') }}" class="devforge-auth-secondary">
                        {{ __('auth.already_registered') }}
                    </a>
                @endif
            </div>
        </div>
    </div>
@endsection

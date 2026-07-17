@extends('layouts.devforge-auth')

@section('content')
    <div class="flex min-h-screen flex-col items-center justify-center px-6 py-8">
        <div class="w-full max-w-md space-y-8">
            <div class="flex flex-col items-center space-y-3 text-center">
                <img
                    src="{{ asset('brand/logo.png') }}"
                    alt="DevForge"
                    class="h-14 w-14 rounded-xl"
                    width="56"
                    height="56"
                />
                <div class="space-y-1">
                    <h1 class="text-3xl font-bold tracking-tight text-white">
                        DevForge
                    </h1>
                    <p class="text-sm text-neutral-400">
                        Connectez-vous pour accéder à votre espace d’administration.
                    </p>
                </div>
            </div>

            <div class="devforge-auth-card space-y-6 p-6">
                @if (session('status'))
                    <div class="rounded-lg border border-success/30 bg-success/10 p-4">
                        <p class="text-sm text-success">{{ session('status') }}</p>
                    </div>
                @endif

                @if (session('error'))
                    <div class="rounded-lg border border-error/30 bg-error/10 p-4">
                        <p class="text-sm text-error">{{ session('error') }}</p>
                    </div>
                @endif

                @if ($errors->any())
                    <div class="rounded-lg border border-error/30 bg-error/10 p-4">
                        @foreach ($errors->all() as $error)
                            <p class="text-sm text-error">{{ $error }}</p>
                        @endforeach
                    </div>
                @endif

                <form action="/login" method="POST" class="flex flex-col gap-4">
                    @csrf
                    @env('local')
                        <x-forms.input value="test@example.com" type="email" autocomplete="email" name="email" required
                            label="{{ __('input.email') }}" />
                        <x-forms.input value="password" type="password" autocomplete="current-password" name="password"
                            required label="{{ __('input.password') }}" />
                    @else
                        <x-forms.input type="email" name="email" autocomplete="email" required
                            label="{{ __('input.email') }}" />
                        <x-forms.input type="password" name="password" autocomplete="current-password" required
                            label="{{ __('input.password') }}" />
                    @endenv

                    <div class="flex items-center justify-between">
                        <a href="/forgot-password"
                            class="text-sm text-neutral-400 transition-colors hover:text-[#fcd452] hover:underline">
                            {{ __('auth.forgot_password_link') }}
                        </a>
                    </div>

                    <x-forms.button class="devforge-auth-primary w-full justify-center py-3" type="submit" isHighlighted>
                        {{ __('auth.login') }}
                    </x-forms.button>
                </form>

                @if ($is_registration_enabled)
                    <div class="relative my-2">
                        <div class="absolute inset-0 flex items-center">
                            <div class="w-full border-t border-neutral-700"></div>
                        </div>
                        <div class="relative flex justify-center text-sm">
                            <span class="bg-[#181818] px-2 text-neutral-500">
                                Pas encore de compte ?
                            </span>
                        </div>
                    </div>
                    <a href="/register"
                        class="block w-full rounded-lg border border-neutral-700 py-3 text-center font-medium transition-colors hover:border-[#fcd452]">
                        {{ __('auth.register_now') }}
                    </a>
                @else
                    <p class="text-center text-sm text-neutral-500">
                        {{ __('auth.registration_disabled') }}
                    </p>
                @endif

                @if ($enabled_oauth_providers->isNotEmpty())
                    <div class="relative my-2">
                        <div class="absolute inset-0 flex items-center">
                            <div class="w-full border-t border-neutral-700"></div>
                        </div>
                        <div class="relative flex justify-center text-sm">
                            <span class="bg-[#181818] px-2 text-neutral-500">ou continuer avec</span>
                        </div>
                    </div>
                    <div class="flex flex-col gap-3">
                        @foreach ($enabled_oauth_providers as $provider_setting)
                            <x-forms.button class="w-full justify-center" type="button"
                                onclick="document.location.href='/auth/{{ $provider_setting->provider }}/redirect'">
                                {{ __("auth.login.$provider_setting->provider") }}
                            </x-forms.button>
                        @endforeach
                    </div>
                @endif
            </div>
        </div>
    </div>
@endsection

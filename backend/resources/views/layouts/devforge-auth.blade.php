<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}" data-theme="dark">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <meta name="theme-color" content="#101010" />
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>DevForge — {{ __('auth.login') }}</title>
    <link rel="icon" href="{{ asset('brand/logo.png') }}" type="image/png" />
    @vite(['resources/js/app.js', 'resources/css/app.css'])
    <style>
        :root {
            --df-base-100: #181818;
            --df-base-200: #101010;
            --df-base-300: #202020;
            --df-content: #e7e7e7;
            --df-muted: color-mix(in oklab, #e7e7e7 55%, transparent);
            --df-primary: #fcd452;
            --df-primary-hover: #fde047;
            --df-primary-content: #101010;
            --df-error: #ef4444;
            --df-success: #22c55e;
            --df-radius-field: 0.75rem;
            --df-radius-box: 1.25rem;
        }

        .devforge-auth-page {
            position: relative;
            isolation: isolate;
            min-height: 100vh;
            margin: 0;
            overflow-x: hidden;
            background: var(--df-base-200);
            color: var(--df-content);
            font-family: 'Geist Sans', ui-sans-serif, system-ui, sans-serif;
            -webkit-font-smoothing: antialiased;
        }

        .devforge-auth-page::before {
            content: '';
            position: fixed;
            inset: 0;
            z-index: -2;
            background:
                radial-gradient(ellipse 70% 50% at 50% -10%, color-mix(in oklab, var(--df-primary) 18%, transparent), transparent 70%),
                radial-gradient(ellipse 45% 40% at 90% 90%, color-mix(in oklab, var(--df-primary) 8%, transparent), transparent 65%),
                radial-gradient(ellipse 40% 35% at 5% 70%, color-mix(in oklab, #ffffff 4%, transparent), transparent 60%),
                var(--df-base-200);
        }

        .devforge-auth-page::after {
            content: '';
            position: fixed;
            inset: 0;
            z-index: -1;
            opacity: 0.35;
            pointer-events: none;
            background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.45'/%3E%3C/svg%3E");
            background-size: 180px 180px;
            mix-blend-mode: soft-light;
        }

        .devforge-auth-shell {
            display: flex;
            min-height: 100vh;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 2rem 1.5rem;
        }

        .devforge-auth-panel {
            width: 100%;
            max-width: 26rem;
            animation: df-auth-rise 480ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        .devforge-auth-brand {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 1rem;
            margin-bottom: 2rem;
            text-align: center;
            animation: df-auth-rise 560ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        .devforge-auth-logo {
            width: 4.5rem;
            height: 4.5rem;
            border-radius: 9999px;
            object-fit: cover;
            box-shadow:
                0 0 0 1px color-mix(in oklab, var(--df-primary) 25%, transparent),
                0 12px 40px color-mix(in oklab, var(--df-primary) 12%, transparent);
            animation: df-auth-glow 4.5s ease-in-out infinite;
        }

        .devforge-auth-title {
            margin: 0;
            font-size: clamp(2.25rem, 6vw, 2.75rem);
            font-weight: 700;
            letter-spacing: -0.04em;
            line-height: 1.1;
            color: #fff;
        }

        .devforge-auth-subtitle {
            margin: 0.35rem 0 0;
            max-width: 22rem;
            font-size: 0.9375rem;
            line-height: 1.5;
            color: var(--df-muted);
        }

        .devforge-auth-card {
            border: 1px solid color-mix(in oklab, var(--df-base-300) 90%, #fff);
            background: var(--df-base-100);
            border-radius: var(--df-radius-box);
            box-shadow: 0 18px 50px color-mix(in oklab, #000 45%, transparent);
            padding: 1.5rem;
        }

        .devforge-auth-label {
            display: block;
            margin-bottom: 0.4rem;
            font-size: 0.8125rem;
            font-weight: 600;
            color: color-mix(in oklab, var(--df-content) 80%, transparent);
        }

        .devforge-auth-input {
            display: block;
            width: 100%;
            min-height: 2.75rem;
            border-radius: var(--df-radius-field);
            border: 1px solid var(--df-base-300);
            background: var(--df-base-200);
            color: var(--df-content);
            padding: 0.625rem 0.875rem;
            font-size: 0.9375rem;
            font-family: inherit;
            transition: border-color 150ms ease, box-shadow 150ms ease;
        }

        .devforge-auth-input::placeholder {
            color: color-mix(in oklab, var(--df-content) 35%, transparent);
        }

        .devforge-auth-input:hover {
            border-color: color-mix(in oklab, var(--df-content) 18%, var(--df-base-300));
        }

        .devforge-auth-input:focus {
            outline: none;
            border-color: color-mix(in oklab, var(--df-primary) 55%, var(--df-base-300));
            box-shadow: 0 0 0 3px color-mix(in oklab, var(--df-primary) 18%, transparent);
        }

        .devforge-auth-primary {
            display: inline-flex;
            min-height: 2.75rem;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            padding-inline: 1.25rem;
            border-radius: 9999px;
            border: 1px solid var(--df-primary);
            background: var(--df-primary);
            color: var(--df-primary-content);
            font-size: 0.9375rem;
            font-weight: 600;
            font-family: inherit;
            cursor: pointer;
            text-decoration: none;
            transition: background 150ms ease, border-color 150ms ease, transform 120ms ease;
        }

        .devforge-auth-primary-block {
            width: 100%;
        }

        .devforge-auth-primary:hover {
            background: var(--df-primary-hover);
            border-color: var(--df-primary-hover);
        }

        .devforge-auth-primary:active {
            transform: scale(0.985);
        }

        .devforge-auth-secondary {
            display: inline-flex;
            width: 100%;
            min-height: 2.75rem;
            align-items: center;
            justify-content: center;
            border-radius: 9999px;
            border: 1px solid var(--df-base-300);
            background: transparent;
            color: var(--df-content);
            font-size: 0.875rem;
            font-weight: 600;
            font-family: inherit;
            cursor: pointer;
            text-decoration: none;
            transition: border-color 150ms ease, background 150ms ease;
        }

        .devforge-auth-secondary:hover {
            border-color: color-mix(in oklab, var(--df-primary) 45%, var(--df-base-300));
            background: color-mix(in oklab, var(--df-primary) 6%, transparent);
        }

        .devforge-auth-link {
            font-size: 0.875rem;
            color: var(--df-muted);
            text-decoration: none;
            transition: color 150ms ease;
        }

        .devforge-auth-link:hover {
            color: var(--df-primary);
            text-decoration: underline;
            text-underline-offset: 3px;
        }

        .devforge-auth-divider {
            position: relative;
            margin: 0.25rem 0;
        }

        .devforge-auth-divider::before {
            content: '';
            position: absolute;
            inset-inline: 0;
            top: 50%;
            border-top: 1px solid var(--df-base-300);
        }

        .devforge-auth-divider span {
            position: relative;
            display: inline-block;
            padding-inline: 0.75rem;
            background: var(--df-base-100);
            font-size: 0.8125rem;
            color: color-mix(in oklab, var(--df-content) 45%, transparent);
        }

        .devforge-auth-alert {
            border-radius: var(--df-radius-field);
            padding: 0.875rem 1rem;
            font-size: 0.875rem;
            line-height: 1.4;
        }

        .devforge-auth-alert-error {
            border: 1px solid color-mix(in oklab, var(--df-error) 35%, transparent);
            background: color-mix(in oklab, var(--df-error) 12%, transparent);
            color: #fca5a5;
        }

        .devforge-auth-alert-success {
            border: 1px solid color-mix(in oklab, var(--df-success) 35%, transparent);
            background: color-mix(in oklab, var(--df-success) 12%, transparent);
            color: #86efac;
        }

        .devforge-auth-field {
            display: grid;
            gap: 0.15rem;
        }

        .devforge-auth-password {
            position: relative;
        }

        .devforge-auth-password .devforge-auth-input {
            padding-inline-end: 2.75rem;
        }

        .devforge-auth-peek {
            position: absolute;
            inset-block: 0;
            inset-inline-end: 0;
            display: inline-flex;
            width: 2.75rem;
            align-items: center;
            justify-content: center;
            border: 0;
            background: transparent;
            color: var(--df-muted);
            cursor: pointer;
        }

        .devforge-auth-peek:hover {
            color: var(--df-content);
        }

        @keyframes df-auth-rise {
            from {
                opacity: 0;
                transform: translateY(12px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        @keyframes df-auth-glow {
            0%, 100% {
                box-shadow:
                    0 0 0 1px color-mix(in oklab, var(--df-primary) 25%, transparent),
                    0 12px 40px color-mix(in oklab, var(--df-primary) 12%, transparent);
            }
            50% {
                box-shadow:
                    0 0 0 1px color-mix(in oklab, var(--df-primary) 40%, transparent),
                    0 16px 48px color-mix(in oklab, var(--df-primary) 22%, transparent);
            }
        }

        @media (prefers-reduced-motion: reduce) {
            .devforge-auth-panel,
            .devforge-auth-brand,
            .devforge-auth-logo {
                animation: none;
            }
        }
    </style>
</head>
<body class="devforge-auth-page">
    @yield('content')
</body>
</html>

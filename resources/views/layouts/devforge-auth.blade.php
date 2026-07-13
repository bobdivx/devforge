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
        .devforge-auth-page {
            min-height: 100vh;
            background: #101010;
            color: #e7e7e7;
            font-family: ui-sans-serif, system-ui, sans-serif;
        }

        .devforge-auth-card {
            border: 1px solid #202020;
            background: #181818;
            border-radius: 1rem;
        }

        .devforge-auth-primary {
            background: #fcd452;
            color: #101010;
            border-color: #fcd452;
        }

        .devforge-auth-primary:hover {
            background: #fde047;
            border-color: #fde047;
        }
    </style>
</head>
<body class="devforge-auth-page">
    @yield('content')
</body>
</html>

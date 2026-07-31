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
    <link rel="stylesheet" href="{{ asset('css/devforge-auth.css') }}" />
</head>
<body class="devforge-auth-page">
    @yield('content')
</body>
</html>

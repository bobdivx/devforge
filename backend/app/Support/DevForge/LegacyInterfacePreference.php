<?php

namespace App\Support\DevForge;

use Illuminate\Http\Request;

class LegacyInterfacePreference
{
    public const SESSION_KEY = 'devforge.prefer_legacy_interface';

    public function sync(Request $request): void
    {
        if (! $request->user() || ! config('devforge.enabled')) {
            return;
        }

        if ($request->is('devforge', 'devforge/*')) {
            $request->session()->forget(self::SESSION_KEY);

            return;
        }

        if ($request->isMethod('GET') && $request->query->has('legacy')) {
            if ($request->boolean('legacy')) {
                $request->session()->put(self::SESSION_KEY, true);
            } else {
                $request->session()->forget(self::SESSION_KEY);
            }
        }
    }

    public function active(Request $request): bool
    {
        return $request->boolean('legacy')
            || (bool) $request->session()->get(self::SESSION_KEY, false);
    }
}

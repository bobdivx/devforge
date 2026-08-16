{{ Illuminate\Mail\Markdown::parse('---') }}

Thank you,<br>
{{ config('app.name') ?? 'DevForge' }}

{{ Illuminate\Mail\Markdown::parse('[Contact Support](https://github.com/bobdivx/devforge') }}

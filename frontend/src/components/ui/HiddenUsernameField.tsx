/** Champ username masqué pour l’accessibilité des formulaires password (Chrome). */
export function HiddenUsernameField({
    username = 'devforge',
    autoComplete = 'username',
}: {
    username?: string;
    autoComplete?: string;
}) {
    return (
        <input
            type="text"
            name="username"
            autoComplete={autoComplete}
            value={username}
            readOnly
            tabIndex={-1}
            aria-hidden="true"
            class="sr-only"
        />
    );
}

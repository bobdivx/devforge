const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function normalizeEnvFileContents(contents: string): string {
    let text = contents;

    if (text.charCodeAt(0) === 0xFEFF) {
        text = text.slice(1);
    }

    text = text.replaceAll('\u0000', '');
    text = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\uFF1D', '=');

    return text.split('\n').map((line) => {
        let next = line.trim();

        if (next === '' || next.startsWith('#') || next.startsWith(';')) {
            return next;
        }

        next = next.replace(/^export\s+/i, '');

        const equals = next.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/s);

        if (equals) {
            return `${equals[1]}=${equals[2]}`;
        }

        const colon = next.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/s);

        if (colon && ENV_KEY.test(colon[1]) && !next.includes('=')) {
            return `${colon[1]}=${colon[2]}`;
        }

        return next;
    }).join('\n');
}

export async function readEnvFile(file: File): Promise<string> {
    const raw = typeof file.text === 'function'
        ? await file.text()
        : await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ''));
            reader.onerror = () => reject(reader.error ?? new Error('Lecture du fichier impossible.'));
            reader.readAsText(file);
        });

    return normalizeEnvFileContents(raw);
}

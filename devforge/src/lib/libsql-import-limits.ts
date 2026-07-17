/** Aligné sur LibsqlDatabaseTransferService::MAX_PAYLOAD_BYTES (512 MiB). */
export const LIBSQL_IMPORT_MAX_BYTES = 524288 * 1024;

/** Seuil soft : avertissement downtime / timeout (20 MiB). */
export const LIBSQL_IMPORT_WARN_BYTES = 20 * 1024 * 1024;

export function isLibsqlImportLarge(fileSize: number): boolean {
    return fileSize >= LIBSQL_IMPORT_WARN_BYTES;
}

export function formatLibsqlImportBytes(size: number): string {
    if (size <= 0) {
        return '—';
    }

    const units = ['o', 'Ko', 'Mo', 'Go'];
    let value = size;
    let unit = 0;

    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }

    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function libsqlImportSizeError(fileSize: number): string | null {
    if (fileSize > LIBSQL_IMPORT_MAX_BYTES) {
        return `Fichier trop volumineux (${formatLibsqlImportBytes(fileSize)}). Limite : 512 Mo.`;
    }

    return null;
}

export function libsqlImportLargeWarning(fileSize: number): string {
    return (
        `Ce fichier fait ${formatLibsqlImportBytes(fileSize)}. `
        + 'L’import arrête temporairement la base (coupure des apps connectées), '
        + 'et le transfert SSH peut prendre plusieurs minutes / timeout sur les gros volumes.'
    );
}

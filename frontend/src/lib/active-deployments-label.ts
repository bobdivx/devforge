export function formatActiveDeploymentsLabel(count: number): string {
    if (count <= 0) {
        return 'Aucun déploiement';
    }

    return count === 1 ? '1 déploiement' : `${count} déploiements`;
}

export function LoadingState() {
    return (
        <div class="grid min-h-[18rem] place-items-center" role="status" aria-label="Chargement">
            <div class="flex items-center gap-2 sm:gap-3 text-sm text-base-content/60">
                <span class="loading loading-spinner loading-sm text-primary" aria-hidden />
                Chargement de l’espace…
            </div>
        </div>
    );
}

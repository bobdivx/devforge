import '@testing-library/jest-dom/vitest';

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
    }),
});

HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
};

HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
};

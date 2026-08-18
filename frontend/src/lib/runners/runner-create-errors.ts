import { ApiError } from '../api/client';

export function looksLikeExistingContainerError(message: string): boolean {
    return message.toLowerCase().includes('existe déjà');
}

export function looksLikeTimeoutError(error: unknown, message: string): boolean {
    return (error instanceof ApiError && error.status === 504)
        || message.includes('504')
        || message.toLowerCase().includes('délai dépassé');
}

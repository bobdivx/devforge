<?php

namespace App\Services\DevForge\Database;

use App\Models\StandaloneLibsql;
use RuntimeException;

/**
 * Turso-compatible JWT credentials for self-hosted libSQL (sqld).
 *
 * @libsql/client sends Authorization: Bearer <JWT>, which requires SQLD_AUTH_JWT_KEY
 * (not legacy SQLD_HTTP_AUTH basic).
 */
class LibsqlJwtCredentials
{
    /**
     * @return array{secret_key: string, public_key: string, token: string}
     */
    public function generate(): array
    {
        $keypair = sodium_crypto_sign_keypair();
        $secretKey = sodium_crypto_sign_secretkey($keypair);
        $publicKey = sodium_crypto_sign_publickey($keypair);

        return [
            'secret_key' => base64_encode($secretKey),
            'public_key' => $this->toBase64Url($publicKey),
            'token' => $this->issueTokenFromSecretKey($secretKey),
        ];
    }

    public function issueToken(string $secretKeyBase64): string
    {
        $secretKey = base64_decode($secretKeyBase64, true);
        if ($secretKey === false || strlen($secretKey) !== SODIUM_CRYPTO_SIGN_SECRETKEYBYTES) {
            throw new RuntimeException('Invalid libSQL JWT secret key.');
        }

        return $this->issueTokenFromSecretKey($secretKey);
    }

    /**
     * Ensure the database has JWT keys + a Bearer token suitable for TURSO_AUTH_TOKEN.
     * Migrates legacy random basic-auth passwords when keys are missing.
     */
    public function ensure(StandaloneLibsql $database): bool
    {
        $changed = false;

        if (blank($database->libsql_jwt_secret_key) || blank($database->libsql_jwt_public_key)) {
            $credentials = $this->generate();
            $database->libsql_jwt_secret_key = $credentials['secret_key'];
            $database->libsql_jwt_public_key = $credentials['public_key'];
            $database->libsql_auth_token = $credentials['token'];
            $changed = true;
        } elseif (! $this->looksLikeJwt((string) $database->libsql_auth_token)) {
            $database->libsql_auth_token = $this->issueToken((string) $database->libsql_jwt_secret_key);
            $changed = true;
        }

        if ($changed) {
            $database->save();
        }

        return $changed;
    }

    public function regenerateToken(StandaloneLibsql $database): string
    {
        $this->ensure($database);
        $database->refresh();

        $token = $this->issueToken((string) $database->libsql_jwt_secret_key);
        $database->libsql_auth_token = $token;
        $database->save();

        return $token;
    }

    /**
     * Import an existing Ed25519 PKCS#8 PEM private key (e.g. Node-generated hotfix).
     */
    public function importFromPem(StandaloneLibsql $database, string $privateKeyPem): string
    {
        $key = openssl_pkey_get_private($privateKeyPem);
        if ($key === false) {
            throw new RuntimeException('Unable to parse libSQL JWT private key PEM.');
        }

        $details = openssl_pkey_get_details($key);
        $seed = $details['ed25519']['priv_key'] ?? null;
        $publicKey = $details['ed25519']['pub_key'] ?? null;

        if (! is_string($seed) || strlen($seed) !== 32 || ! is_string($publicKey) || strlen($publicKey) !== 32) {
            throw new RuntimeException('libSQL JWT PEM is not a valid Ed25519 key.');
        }

        $secretKey = $seed.$publicKey;
        $database->libsql_jwt_secret_key = base64_encode($secretKey);
        $database->libsql_jwt_public_key = $this->toBase64Url($publicKey);
        $database->libsql_auth_token = $this->issueTokenFromSecretKey($secretKey);
        $database->save();

        return (string) $database->libsql_auth_token;
    }

    public function sqldAuthJwtKey(StandaloneLibsql $database): string
    {
        $this->ensure($database);
        $database->refresh();

        return (string) $database->libsql_jwt_public_key;
    }

    private function issueTokenFromSecretKey(string $secretKey): string
    {
        $header = $this->toBase64Url(json_encode(['alg' => 'EdDSA', 'typ' => 'JWT'], JSON_THROW_ON_ERROR));
        $payload = $this->toBase64Url(json_encode([
            'a' => 'rw',
            'iat' => time(),
        ], JSON_THROW_ON_ERROR));

        $data = $header.'.'.$payload;
        $signature = sodium_crypto_sign_detached($data, $secretKey);

        return $data.'.'.$this->toBase64Url($signature);
    }

    private function looksLikeJwt(string $token): bool
    {
        return substr_count($token, '.') === 2;
    }

    private function toBase64Url(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }
}

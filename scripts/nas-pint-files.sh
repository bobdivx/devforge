#!/usr/bin/env bash
set -eu
cd /DATA/.devforge/test-env
tar -xzf /DATA/.devforge/staging/pint-targets.tgz
chmod -R a+rwX app tests config || true
docker run --rm --entrypoint '' \
  --user 0:0 \
  -v /DATA/.devforge/test-env:/var/www/html \
  -w /var/www/html \
  ghcr.io/coollabsio/coolify:latest \
  php vendor/bin/pint --format agent \
    app/Services/DevForge/Agent \
    app/Services/DevForge/SecretRedactor.php \
    app/Jobs/Agent \
    config/devforge.php \
    tests/Unit/DevForge/AgentToolPackageDefaultsTest.php \
    tests/Unit/DevForge/AgentToolPackagesTest.php \
    tests/Unit/DevForge/DeploymentFailureAgentDispatcherTest.php \
    tests/Pest.php
echo PINT_DONE
tar -czf /DATA/.devforge/staging/pint-result.tgz \
  app/Services/DevForge/Agent \
  app/Services/DevForge/SecretRedactor.php \
  app/Jobs/Agent \
  config/devforge.php \
  tests/Unit/DevForge/AgentToolPackageDefaultsTest.php \
  tests/Unit/DevForge/AgentToolPackagesTest.php \
  tests/Unit/DevForge/DeploymentFailureAgentDispatcherTest.php \
  tests/Pest.php
ls -la /DATA/.devforge/staging/pint-result.tgz
